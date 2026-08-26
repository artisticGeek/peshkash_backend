/**
 * OtpService — Redis-backed OTP lifecycle.
 *
 * Key schema : peshkash:otp:{phone}
 * TTL        : 10 minutes
 * Max attempts: 3 (brute-force guard)
 *
 * Requires the same Redis instance as AnalyticsQueue.
 * Falls back gracefully when Redis is unavailable (mock / in-memory).
 */

import Redis from 'ioredis';
import { SmsService } from './SmsService';

const OTP_TTL     = 10 * 60;  // 10 minutes in seconds
const MAX_ATTEMPTS = 3;
const OTP_PREFIX   = 'peshkash:otp:';

interface OtpRecord {
  otp:      string;
  attempts: number;
}

// ── Reuse the Redis URL from env (same as AnalyticsQueue) ────────────────────
let redis: Redis | null = null;

if (process.env.REDIS_URL) {
  redis = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableReadyCheck:     false,
    enableOfflineQueue:   false,
    lazyConnect:          true,
  });
  redis.connect().catch(() => {});
}

// In-memory fallback (dev without Redis) — simple Map, no TTL enforcement beyond service restart
const inMemory = new Map<string, { record: OtpRecord; expiresAt: number }>();

function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export const OtpService = {
  /** Generate an OTP, store it, and dispatch via SMS. */
  async sendOtp(phone: string): Promise<void> {
    const otp = generateOtp();
    const record: OtpRecord = { otp, attempts: 0 };

    if (redis) {
      await redis.set(
        OTP_PREFIX + phone,
        JSON.stringify(record),
        'EX', OTP_TTL
      ).catch(() => {});
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

    if (redis) {
      const raw = await redis.get(key).catch(() => null);
      if (!raw) return false;

      let record: OtpRecord;
      try { record = JSON.parse(raw); }
      catch { return false; }

      record.attempts++;

      if (record.attempts >= MAX_ATTEMPTS) {
        await redis.del(key).catch(() => {});
        return false;
      }

      if (record.otp !== otp) {
        await redis.set(key, JSON.stringify(record), 'KEEPTTL').catch(() => {});
        return false;
      }

      await redis.del(key).catch(() => {});
      return true;

    } else {
      // In-memory path
      const entry = inMemory.get(phone);
      if (!entry || Date.now() > entry.expiresAt) {
        inMemory.delete(phone);
        return false;
      }

      entry.record.attempts++;

      if (entry.record.attempts >= MAX_ATTEMPTS) {
        inMemory.delete(phone);
        return false;
      }

      if (entry.record.otp !== otp) return false;

      inMemory.delete(phone);
      return true;
    }
  },
};
