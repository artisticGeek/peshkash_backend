/**
 * authMiddleware — attaches verified user to req.user when a valid Bearer token
 * is present. Non-blocking: requests without a token pass through with req.user = null.
 *
 * Force-logout: after JWT verification, a single DB query checks whether an admin
 * has invalidated this session (per-phone or globally). If the token was issued
 * before the invalidation timestamp, the request is rejected with 401 + code
 * "session_invalidated" so the frontend can auto-logout cleanly.
 *
 * Usage:
 *   app.use(authMiddleware);                          // attach everywhere
 *   router.get('/protected', requireRole('admin'), handler);  // guard specific routes
 */

import { Request, Response, NextFunction } from 'express';
import { QueryTypes } from 'sequelize';
import { sequelize } from '../config/sequelize';
import { AuthService, AuthPayload, Role } from '../services/AuthService';

// Augment Express Request to carry auth payload
declare global {
  namespace Express {
    interface Request {
      user: AuthPayload | null;
    }
  }
}

/** Attaches req.user from Bearer token. Returns 401 if the session has been force-invalidated. */
export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  req.user = null;
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Bearer ')) { next(); return; }

  const token = header.slice(7);
  const payload = AuthService.verifyToken(token);
  if (!payload) { next(); return; }

  // Check session_invalidation table — one query covers both the per-phone row
  // and the __global__ row; we take the most recent cutoff that applies.
  const iatMs = (payload.iat ?? 0) * 1000;
  try {
    const rows = await sequelize.query<{ cutoff: string }>(
      `SELECT MAX(invalidate_before) AS cutoff
       FROM session_invalidation
       WHERE phone IN (:phone, '__global__')`,
      { replacements: { phone: payload.phone }, type: QueryTypes.SELECT },
    );
    const cutoff = rows[0]?.cutoff;
    if (cutoff && new Date(cutoff).getTime() > iatMs) {
      res.status(401).json({
        error: 'Session invalidated. Please log in again.',
        code:  'session_invalidated',
      });
      return;
    }
  } catch {
    // Table may not exist yet on first boot — allow through
  }

  req.user = payload;
  next();
}

/** Hard gate — rejects requests that don't have one of the allowed roles. */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions.' });
    }
    next();
  };
}
