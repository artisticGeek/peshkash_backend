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
        // Redis degraded mid-flight — the OTP was almost certainly stored via
        // Redis too, so there's nothing left to check; fail safe (not found)
        // rather than crash, and stop hitting Redis for a while.
        console.error('[OtpService] Redis read failed, degrading to in-memory:', err?.message);
        degrade();
        return false;
      }

    } else {
      // In-memory path
      const entry = inMemory.get(phone);
      if (!entry || Date.now() > entry.expiresAt) {
        inMemory.delete(phone);
        return false;
      }

      if (entry.record.otp === otp) {
        inMemory.delete(phone);
        return true;
      }

      entry.record.attempts++;
      if (entry.record.attempts >= MAX_ATTEMPTS) inMemory.delete(phone);
      return false;
    }
  },
};
