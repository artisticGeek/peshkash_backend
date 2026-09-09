/**
 * OtpService — Redis-backed OTP lifecycle.
 *
 * Key schema : peshkash:otp:{phone}
 * TTL        : 10 minutes
 * Max attempts: 3 (brute-force guard)
 *
 * Requires the same Redis instance as AnalyticsQueue.
 * Falls back gracefully when Redis is unavailable (mock / in-memory) — both
 * when REDIS_URL is unset AND when a command fails at runtime (e.g. Upstash
 * quota exhaustion). A runtime failure trips a per-phone cooldown so a
 * still-over-quota Redis isn't hammered with retries on every request for
 * that phone, without blocking other phones whose own commands are fine;
 * single-instance deployments (current Render free tier) are safe with
 * in-memory fallback.
 */

import Redis from 'ioredis';
import { SmsService } from './SmsService';

const OTP_TTL       = 10 * 60;  // 10 minutes in seconds
const MAX_ATTEMPTS  = 3;
const OTP_PREFIX    = 'peshkash:otp:';
const DEGRADE_MS    = 30 * 1000; // skip Redis for this long, for this phone, after a runtime failure

interface OtpRecord {
  otp:      string;
  attempts: number;
}

// ── Reuse the Redis URL from env (same as AnalyticsQueue) ────────────────────
let redis: Redis | null = null;

// Per-phone, not global — an unrelated phone's Redis failure must not block
// verification of a different phone whose OTP is sitting in Redis just fine.
const degradedUntil = new Map<string, number>();

if (process.env.REDIS_URL) {
  redis = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableReadyCheck:     false,
    enableOfflineQueue:   false,
    lazyConnect:          true,
  });
  redis.connect().catch(() => {});
}

function redisUsable(phone: string): boolean {
  return !!redis && Date.now() > (degradedUntil.get(phone) ?? 0);
}

function degrade(phone: string): void {
  degradedUntil.set(phone, Date.now() + DEGRADE_MS);
}

// In-memory fallback (dev without Redis, or Redis degraded) — simple Map, no TTL enforcement beyond service restart
const inMemory = new Map<string, { record: OtpRecord; expiresAt: number }>();

function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * Check `otp` against `record`, advancing its attempt count in place.
 * Shared by the in-memory and Redis verify paths so the two backends can't
 * drift on the match/attempt/lockout rule the way they did before.
 */
function evaluateAttempt(record: OtpRecord, otp: string): { matched: boolean; shouldDelete: boolean } {
  if (record.otp === otp) return { matched: true, shouldDelete: true };
  record.attempts++;
  return { matched: false, shouldDelete: record.attempts >= MAX_ATTEMPTS };
}

export const OtpService = {
  /** Generate an OTP, store it, and dispatch via SMS. */
  async sendOtp(phone: string): Promise<void> {
    const otp = generateOtp();
    const record: OtpRecord = { otp, attempts: 0 };
    let stored = false;

    if (redisUsable(phone)) {
      try {
        const result = await redis!.set(
          OTP_PREFIX + phone,
          JSON.stringify(record),
          'EX', OTP_TTL
        );
        if (result !== 'OK') throw new Error('Could not store OTP.');
        stored = true;
        // A previous degrade may have left a stale record for this phone in
        // memory — clear it so verifyOtp's memory-first check can't shadow
        // this fresh Redis write with an old, already-superseded code.
        inMemory.delete(phone);
      } catch (err: any) {
        // Redis is configured but failing at runtime (e.g. quota exhausted) —
        // degrade to in-memory rather than failing every OTP send.
        console.error('[OtpService] Redis write failed, degrading to in-memory:', err?.message);
        degrade(phone);
      }
    }

    if (!stored) {
      inMemory.set(phone, { record, expiresAt: Date.now() + OTP_TTL * 1000 });
    }

    await SmsService.send(phone, otp);
  },

  /**
   * Verify an OTP.
   * Returns true if correct and within TTL.
   * Deletes the OTP on success or after MAX_ATTEMPTS failures.
   */
  async verifyOtp(phone: string, otp: string): Promise<boolean> {
    const key = OTP_PREFIX + phone;

    // Check in-memory first, regardless of the current redisUsable() state.
    // degradedUntil is a short, independent cooldown — if sendOtp degraded to
    // memory because a single Redis command failed, that cooldown can easily
    // lapse before the user finishes typing the code (OTP entry routinely
    // takes well over 30s). Deciding verify's store from the *current*
    // status instead of "wherever send actually wrote it" meant a correct
    // code looked up an empty Redis key and was rejected. Checking memory
    // first makes send and verify agree on the same record regardless of
    // what Redis's status has drifted to in between.
    const memEntry = inMemory.get(phone);
    if (memEntry) {
      if (Date.now() > memEntry.expiresAt) {
        inMemory.delete(phone);
        return false;
      }
      const { matched, shouldDelete } = evaluateAttempt(memEntry.record, otp);
      if (shouldDelete) inMemory.delete(phone);
      return matched;
    }

    if (redisUsable(phone)) {
      try {
        const raw = await redis!.get(key);
        if (!raw) return false;

        let record: OtpRecord;
        try { record = JSON.parse(raw); }
        catch { return false; }

        const { matched, shouldDelete } = evaluateAttempt(record, otp);
        if (shouldDelete) {
          await redis!.del(key);
        } else {
          await redis!.set(key, JSON.stringify(record), 'KEEPTTL');
        }
        return matched;
      } catch (err: any) {
        console.error('[OtpService] Redis read failed, degrading to in-memory:', err?.message);
        degrade(phone);
        return false;
      }
    }

    return false;
  },
};
