/**
 * Analytics drain loop — runs inside the main Express process.
 *
 * Drains the Redis queue into Postgres, polling as fast as MIN_INTERVAL_MS
 * while events are flowing and backing off toward MAX_INTERVAL_MS when the
 * queue is empty. A fixed-rate poll (the previous approach) sent an RPOP to
 * Redis every 500ms forever — ~5.2M requests/month at idle alone, enough to
 * exhaust Upstash's free-tier request quota on its own and take down every
 * other Redis-backed feature (OTP login included, since it shares the same
 * instance) once the quota is hit.
 *
 * Scaling path (when you outgrow free tier):
 *   1. Remove startDrainLoop() from app.ts
 *   2. Add a separate Render worker dyno that runs:
 *        import { startDrainLoop } from './workers/analyticsWorker'
 *        startDrainLoop()
 *   No other code changes needed — the queue interface stays identical.
 */

import { AnalyticsQueue } from '../services/AnalyticsQueue';

const MIN_INTERVAL_MS = 500;    // flush this often while the queue is active
const MAX_INTERVAL_MS = 10_000; // back off to this often once idle
const LOG_EVERY_N      = 120;   // log throughput every ~this many non-empty drains

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
        currentInterval = Math.min(currentInterval * 2, MAX_INTERVAL_MS);
      }
    } catch {
      // drain() already handles its own errors — this is a safety net
    }

    timer = setTimeout(tick, currentInterval);
    if (timer.unref) timer.unref(); // don't block process exit
  };

  timer = setTimeout(tick, currentInterval);
  if (timer.unref) timer.unref();

  console.log(`✅ [AnalyticsWorker] drain loop started (${MIN_INTERVAL_MS}-${MAX_INTERVAL_MS}ms adaptive interval, batch=500)`);
}

export function stopDrainLoop(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  currentInterval = MIN_INTERVAL_MS;
}
