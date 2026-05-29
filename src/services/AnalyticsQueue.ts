/**
 * AnalyticsQueue — Redis-backed write buffer for analytics events.
 *
 * Architecture:
 *   Producer (HTTP thread): enqueue() → LPUSH  — O(1), ~0.1ms, never blocks
 *   Consumer (drain loop):  drain()   → RPOP count + bulkCreate — runs every 500ms
 *
 * Graceful degradation:
 *   REDIS_URL not set → direct DB insert (local dev / first deploy without Redis)
 *   Redis unreachable  → falls back to direct insert per event, logs once
 *
 * Requires Redis 6.2+ (Upstash default) for RPOP with count argument.
 */

import Redis from 'ioredis';
import { AnalyticsEvent } from '../models/analyticsEvent.model';
import { AnalyticsRepo, InsertPayload } from '../repositories/analytics.repository';

const QUEUE_KEY   = 'peshkash:analytics:queue';
const BATCH_SIZE  = 500;  // rows per drain cycle — one bulkCreate call

// ── Redis client (lazy — only created if REDIS_URL is configured) ────────────

let redis: Redis | null = null;
let redisReady = false;
let warnedOnce = false;

if (process.env.REDIS_URL) {
  redis = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 1,     // fail fast — analytics must never block the app
    enableReadyCheck: true,
    lazyConnect: true,
    tls: process.env.REDIS_URL.startsWith('rediss://') ? {} : undefined,
  });

  redis.on('ready', () => {
    redisReady = true;
    console.log('✅ [AnalyticsQueue] Redis connected');
  });

  redis.on('error', (err) => {
    redisReady = false;
    if (!warnedOnce) {
      console.warn('[AnalyticsQueue] Redis error — falling back to direct inserts:', err.message);
      warnedOnce = true;
    }
  });

  redis.connect().catch(() => {
    // connect() promise rejection is already handled by the 'error' event above
  });
}

// ── Public interface ──────────────────────────────────────────────────────────

export const AnalyticsQueue = {

  /**
   * Push one event payload onto the queue.
   * ~0.1ms when Redis is healthy. Falls back to direct insert if Redis is down.
   * Never throws — analytics must never affect the caller.
   */
  enqueue(payload: InsertPayload): void {
    if (redis && redisReady) {
      redis.lpush(QUEUE_KEY, JSON.stringify(payload)).catch(() => {
        // Redis write failed mid-flight — fall back to direct insert
        AnalyticsRepo.insert(payload).catch(() => {});
      });
    } else {
      // No Redis configured or Redis is down — insert directly
      AnalyticsRepo.insert(payload).catch(() => {});
    }
  },

  /**
   * Drain up to BATCH_SIZE items from the queue and persist via bulkCreate.
   * Called on a setInterval by the drain loop. Returns rows flushed.
   * Safe to call from multiple instances — RPOP is atomic.
   */
  async drain(): Promise<number> {
    if (!redis || !redisReady) return 0;

    let raw: string[] | null = null;
    try {
      // RPOP key count — atomically removes up to BATCH_SIZE items from tail
      raw = await (redis as any).rpop(QUEUE_KEY, BATCH_SIZE);
    } catch {
      return 0; // Redis blip — retry on next tick
    }

    if (!raw || !raw.length) return 0;

    const payloads = raw
      .map(item => { try { return JSON.parse(item) as InsertPayload; } catch { return null; } })
      .filter((p): p is InsertPayload => p !== null);

    if (!payloads.length) return 0;

    try {
      await AnalyticsEvent.bulkCreate(payloads as any[]);
    } catch (err: any) {
      // DB write failure — for analytics, dropping is acceptable.
      // Log so it's visible in production monitoring.
      console.error(`[AnalyticsQueue] bulkCreate failed (${payloads.length} rows dropped):`, err?.message);
    }

    return payloads.length;
  },

  /** Queue depth — useful for a health/readiness endpoint */
  async depth(): Promise<number> {
    if (!redis || !redisReady) return 0;
    try { return await redis.llen(QUEUE_KEY); }
    catch { return 0; }
  },

  get isRedisConnected(): boolean {
    return redisReady;
  },
};
