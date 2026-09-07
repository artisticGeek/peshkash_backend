/**
 * AppConfigUtil — cached reads of a single `app_config` row.
 *
 * Shared by every DB-configured runtime setting (SMS provider, analytics
 * drain backoff, ...) so the "cache this key for a while, fall back to a
 * default if the row is missing/the DB is slow" mechanics live in one place
 * instead of being copy-pasted per setting.
 */

import { sequelize } from '../config/sequelize';
import { QueryTypes } from 'sequelize';

/**
 * Returns a `read()` function that caches `key`'s value from `app_config`
 * for `ttlMs`, falling back to `defaultValue` if the row is absent, the
 * query fails, or it doesn't resolve within `timeoutMs` — a query stuck
 * behind a slow/contended DB can't stall whichever hot path calls this.
 */
export function makeAppConfigReader(
  key: string,
  defaultValue: string,
  { ttlMs = 30_000, timeoutMs = 2_000 }: { ttlMs?: number; timeoutMs?: number } = {}
): () => Promise<string> {
  let cached: string | null = null;
  let expiry = 0;

  return async function read(): Promise<string> {
    if (cached !== null && Date.now() < expiry) return cached;

    let timeoutHandle!: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error(`app_config read of '${key}' timed out`)), timeoutMs);
    });
    timeout.catch(() => {}); // avoid an unhandled rejection if the query wins the race

    try {
      const rows = await Promise.race([
        sequelize.query<{ value: string }>(
          `SELECT value FROM app_config WHERE key = :key LIMIT 1`,
          { type: QueryTypes.SELECT, replacements: { key } }
        ),
        timeout,
      ]);
      cached = rows[0]?.value ?? defaultValue;
    } catch {
      cached = defaultValue;
    } finally {
      clearTimeout(timeoutHandle);
    }

    expiry = Date.now() + ttlMs;
    return cached;
  };
}
