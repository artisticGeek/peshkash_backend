/**
 * Analytics drain loop — runs inside the main Express process.
 *
 * Drains the Redis queue into Postgres, polling as fast as MIN_INTERVAL_MS
 * while events are flowing and backing off toward the configured max interval
 * when the queue is empty. A fixed-rate poll (the original approach) sent an
 * RPOP to Redis every 500ms forever — ~5.2M requests/month at idle alone,
 * enough to exhaust Upstash's free-tier request quota on its own and take
 * down every other Redis-backed feature (OTP login included, since it shares
 * the same instance) once the quota is hit.
 *
 * Max idle interval is DB-configured, same pattern as SmsService's provider:
 *   app_config WHERE key = 'analytics_drain_max_interval_ms'  (default: 20000)
 *
 * To change it, run directly in the DB:
 *   UPDATE app_config SET value = '30000', updated_at = NOW()
 *     WHERE key = 'analytics_drain_max_interval_ms';
 *
 * Scaling path (when you outgrow free tier):
 *   1. Remove startDrainLoop() from app.ts
 *   2. Add a separate Render worker dyno that runs:
 *        import { startDrainLoop } from './workers/analyticsWorker'
 *        startDrainLoop()
 *   No other code changes needed — the queue interface stays identical.
 */

import { sequelize } from '../config/sequelize';
import { QueryTypes } from 'sequelize';
import { AnalyticsQueue } from '../services/AnalyticsQueue';

const MIN_INTERVAL_MS         = 500;     // flush this often while the queue is active
const DEFAULT_MAX_INTERVAL_MS = 20_000;  // back off to this often once idle, absent DB config
const CONFIG_KEY              = 'analytics_drain_max_interval_ms';
const LOG_EVERY_N             = 120;     // log throughput every ~this many non-empty drains

// ── Max-interval cache (30s TTL — avoids a DB query on every idle tick) ──────
let _cachedMaxInterval: number | null = null;
let _cacheExpiry = 0;

async function getMaxInterval(): Promise<number> {
  if (_cachedMaxInterval !== null && Date.now() < _cacheExpiry) return _cachedMaxInterval;
  try {
    const rows = await sequelize.query<{ value: string }>(
      `SELECT value FROM app_config WHERE key = '${CONFIG_KEY}' LIMIT 1`,
      { type: QueryTypes.SELECT }
    );
    const parsed = Number(rows[0]?.value);
    _cachedMaxInterval = Number.isFinite(parsed) && parsed >= MIN_INTERVAL_MS ? parsed : DEFAULT_MAX_INTERVAL_MS;
  } catch {
    _cachedMaxInterval = DEFAULT_MAX_INTERVAL_MS; // safe default if DB unavailable
  }
  _cacheExpiry = Date.now() + 30_000;
  return _cachedMaxInterval;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let currentInterval = MIN_INTERVAL_MS;
let cycleCount = 0;
let totalFlushed = 0;

export function startDrainLoop(): void {
  if (timer) return; // already running

  const tick = async () => {
    try {
      const flushed = await AnalyticsQueue.drain();
      if (flushed > 0) {
        currentInterval = MIN_INTERVAL_MS;
        totalFlushed += flushed;
        cycleCount++;
        if (cycleCount % LOG_EVERY_N === 0) {
          const depth = await AnalyticsQueue.depth();
          console.log(`[AnalyticsWorker] flushed=${totalFlushed} total | queue depth=${depth}`);
        }
      } else {
        const maxInterval = await getMaxInterval();
        currentInterval = Math.min(currentInterval * 2, maxInterval);
      }
    } catch {
      // drain() already handles its own errors — this is a safety net
    }

    timer = setTimeout(tick, currentInterval);
    if (timer.unref) timer.unref(); // don't block process exit
  };

  timer = setTimeout(tick, currentInterval);
  if (timer.unref) timer.unref();

  console.log(`✅ [AnalyticsWorker] drain loop started (${MIN_INTERVAL_MS}ms-${DEFAULT_MAX_INTERVAL_MS}ms default adaptive interval, batch=500)`);
}

export function stopDrainLoop(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  currentInterval = MIN_INTERVAL_MS;
}
