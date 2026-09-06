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
 * quota exhaustion). A runtime failure trips a cooldown so a still-over-quota
 * Redis isn't hammered with retries on every request; single-instance
 * deployments (current Render free tier) are safe with in-memory fallback.
 */

import Redis from 'ioredis';
import { SmsService } from './SmsService';

const OTP_TTL       = 10 * 60;  // 10 minutes in seconds
const MAX_ATTEMPTS  = 3;
const OTP_PREFIX    = 'peshkash:otp:';
const DEGRADE_MS    = 30 * 1000; // skip Redis for this long after a runtime failure

interface OtpRecord {
  otp:      string;
  attempts: number;
}

// ── Reuse the Redis URL from env (same as AnalyticsQueue) ────────────────────
let redis: Redis | null = null;
let degradedUntil = 0;

if (process.env.REDIS_URL) {
  redis = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableReadyCheck:     false,
    enableOfflineQueue:   false,
    lazyConnect:          true,
  });
  redis.connect().catch(() => {});
}

function redisUsable(): boolean {
  return !!redis && Date.now() > degradedUntil;
}

function degrade(): void {
  degradedUntil = Date.now() + DEGRADE_MS;
}

// In-memory fallback (dev without Redis, or Redis degraded) — simple Map, no TTL enforcement beyond service restart
const inMemory = new Map<string, { record: OtpRecord; expiresAt: number }>();

function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export const OtpService = {
  /** Generate an OTP, store it, and dispatch via SMS. */
  async sendOtp(phone: string): Promise<void> {
    const otp = generateOtp();
    const record: OtpRecord = { otp, attempts: 0 };

    if (redisUsable()) {
      try {
        const stored = await redis!.set(
          OTP_PREFIX + phone,
          JSON.stringify(record),
          'EX', OTP_TTL
        );
        if (stored !== 'OK') throw new Error('Could not store OTP.');
      } catch (err: any) {
        // Redis is configured but failing at runtime (e.g. quota exhausted) —
        // degrade to in-memory rather than failing every OTP send.
        console.error('[OtpService] Redis write failed, degrading to in-memory:', err?.message);
        degrade();
        inMemory.set(phone, { record, expiresAt: Date.now() + OTP_TTL * 1000 });
      }
    } else {
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
      if (memEntry.record.otp === otp) {
        inMemory.delete(phone);
        return true;
      }
      memEntry.record.attempts++;
      if (memEntry.record.attempts >= MAX_ATTEMPTS) inMemory.delete(phone);
      return false;
    }

    if (redisUsable()) {
      try {
        const raw = await redis!.get(key);
        if (!raw) return false;

        let record: OtpRecord;
        try { record = JSON.parse(raw); }
        catch { return false; }

        // Check the code before charging an attempt. The old order rejected a
        // correct code on the third submission because attempts reached the
        // limit first.
        if (record.otp === otp) {
          await redis!.del(key);
          return true;
        }

        record.attempts++;
        if (record.attempts >= MAX_ATTEMPTS) {
          await redis!.del(key);
        } else {
          await redis!.set(key, JSON.stringify(record), 'KEEPTTL');
        }
        return false;
      } catch (err: any) {
        console.error('[OtpService] Redis read failed, degrading to in-memory:', err?.message);
        degrade();
        return false;
      }
    }

    return false;
  },
};
