/**
 * authMiddleware — attaches verified user to req.user when a valid Bearer token
 * is present. Non-blocking: requests without a token pass through with req.user = null.
 *
 * Usage:
 *   app.use(authMiddleware);                          // attach everywhere
 *   router.get('/protected', requireRole('admin'), handler);  // guard specific routes
 */

import { Request, Response, NextFunction } from 'express';
import { AuthService, AuthPayload, Role } from '../services/AuthService';

// Augment Express Request to carry auth payload
declare global {
  namespace Express {
    interface Request {
      user: AuthPayload | null;
    }
  }
}

/** Attaches req.user from Bearer token. Always calls next(). */
export function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  req.user = null;
  const header = req.headers.authorization ?? '';
  if (header.startsWith('Bearer ')) {
    const token = header.slice(7);
    req.user = AuthService.verifyToken(token);
  }
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
