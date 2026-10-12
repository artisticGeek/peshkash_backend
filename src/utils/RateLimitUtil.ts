import { Request, Response, NextFunction } from 'express';

/**
 * Small in-memory fixed-window limiter for the registration, pass and check-in endpoints.
 * Per process: with several instances each one enforces its own window, which still bounds a
 * guessing attack by orders of magnitude (pass tokens have 2^128 possibilities).
 */
const buckets = new Map<string, { count: number; resetAt: number }>();
let lastSweep = Date.now();

export function hit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  if (now - lastSweep > 60_000) {
    for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    lastSweep = now;
  }
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limit;
}

export function clientIp(req: Request): string {
  const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  return forwarded || req.ip || req.socket?.remoteAddress || 'unknown';
}

/** Express middleware; `by` picks what the window is keyed on. */
export function rateLimit(name: string, limit: number, windowMs: number, by: 'ip' | 'phone' = 'ip') {
  return (req: Request, res: Response, next: NextFunction) => {
    const who = by === 'phone' && req.user?.phone ? req.user.phone : clientIp(req);
    if (!hit(`${name}:${who}`, limit, windowMs)) {
      res.setHeader('Retry-After', String(Math.ceil(windowMs / 1000)));
      res.status(429).json({ error: 'Too many attempts. Please wait a moment and try again.' });
      return;
    }
    next();
  };
}

export function resetRateLimits() { buckets.clear(); }
