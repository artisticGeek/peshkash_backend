/**
 * Analytics drain loop — runs inside the main Express process.
 *
 * Drains the Redis queue into Postgres every DRAIN_INTERVAL_MS.
 * Single setInterval: safe on free-tier single-instance deployments.
 *
 * Scaling path (when you outgrow free tier):
 *   1. Remove startDrainLoop() from app.ts
 *   2. Add a separate Render worker dyno that runs:
 *        import { startDrainLoop } from './workers/analyticsWorker'
 *        startDrainLoop()
 *   No other code changes needed — the queue interface stays identical.
 */

import { AnalyticsQueue } from '../services/AnalyticsQueue';

const DRAIN_INTERVAL_MS = 500;   // flush every 500ms
const LOG_EVERY_N       = 120;   // log throughput every ~60 seconds

let timer: ReturnType<typeof setInterval> | null = null;
let cycleCount = 0;
let totalFlushed = 0;

export function startDrainLoop(): void {
  if (timer) return; // already running

  timer = setInterval(async () => {
    try {
      const flushed = await AnalyticsQueue.drain();
      if (flushed > 0) {
        totalFlushed += flushed;
        cycleCount++;
        if (cycleCount % LOG_EVERY_N === 0) {
          const depth = await AnalyticsQueue.depth();
          console.log(`[AnalyticsWorker] flushed=${totalFlushed} total | queue depth=${depth}`);
        }
      }
    } catch {
      // drain() already handles its own errors — this is a safety net
    }
  }, DRAIN_INTERVAL_MS);

  // Don't block process exit
  if (timer.unref) timer.unref();

  console.log(`✅ [AnalyticsWorker] drain loop started (interval=${DRAIN_INTERVAL_MS}ms, batch=${500})`);
}

export function stopDrainLoop(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
