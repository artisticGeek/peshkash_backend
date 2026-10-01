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
import { ALL_SECTIONS, AuthService, AuthPayload, Role } from '../services/AuthService';

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

  // Refresh vendor associations on every authenticated request. This makes
  // phone-to-vendor changes effective immediately instead of waiting for the
  // long-lived JWT to be replaced.
  if (payload.role === 'vendor') {
    try {
      const [vendors, grants] = await Promise.all([
        sequelize.query<{ id: string | number }>(
          'SELECT id FROM vendor WHERE phone = :phone ORDER BY id',
          { replacements: { phone: payload.phone }, type: QueryTypes.SELECT },
        ),
        sequelize.query<{ section: string }>(
          'SELECT section FROM admin_section_grant WHERE phone = :phone ORDER BY section',
          { replacements: { phone: payload.phone }, type: QueryTypes.SELECT },
        ),
      ]);
      payload.vendorIds = vendors.map((vendor) => Number(vendor.id));
      payload.vendorId = payload.vendorIds[0] ?? null;
      payload.sectionGrants = grants.map((grant) => grant.section);
      if (!payload.vendorIds.length) {
        res.status(403).json({ error: 'No vendor workspace is associated with this phone.' });
        return;
      }
    } catch {
      res.status(503).json({ error: 'Could not verify vendor workspace access.' });
      return;
    }
  } else if (payload.role === 'admin') {
    payload.sectionGrants = ALL_SECTIONS;
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

/**
 * Hard gate — a vendor user must hold this section grant. The section itself is always
 * hardcoded in the route definition, never read from the request, so there's nothing
 * for a client to spoof by sending a different section name.
 *
 * Deliberately re-queries admin_section_grant on every request instead of trusting the
 * `sectionGrants` JWT claim: a token can live up to a year (JWT_TTL_HOURS), and a grant
 * needs to be revocable immediately by editing one DB row, not by forcing a re-login.
 *
 * Admins are superusers and always pass. Vendor data is scoped separately by vendorIds.
 */
export function requireSection(...sections: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (req.user.role === 'admin') { next(); return; }
    try {
      const rows = await sequelize.query<{ exists: boolean }>(
        'SELECT 1 AS exists FROM admin_section_grant WHERE phone = :phone AND section IN (:sections) LIMIT 1',
        { replacements: { phone: req.user.phone, sections }, type: QueryTypes.SELECT },
      );
      if (!rows.length) {
        return res.status(403).json({ error: 'Insufficient permissions for this section.' });
      }
    } catch {
      return res.status(503).json({ error: 'Could not verify section permissions.' });
    }
    next();
  };
}

type VendorAccessOptions = {
  vendor?: 'query' | 'body' | 'params';
  vendorRequired?: boolean;
  event?: 'query' | 'body' | 'params';
  item?: 'query' | 'body' | 'params';
};

/** Enforce that a vendor-scoped request resolves to one of the caller's live workspaces. */
export function requireVendorAccess(options: VendorAccessOptions = {}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
    if (req.user.role === 'admin') { next(); return; }

    const allowed = req.user.vendorIds ?? (req.user.vendorId ? [Number(req.user.vendorId)] : []);
    const source = (kind: 'query' | 'body' | 'params') => req[kind] as Record<string, unknown>;
    const vendorIdsToCheck: number[] = [];
    let vendorId = options.vendor ? Number(source(options.vendor).vendorId) : 0;
    if (!vendorId && options.vendor) vendorId = Number(req.body?.vendorId ?? req.query?.vendorId ?? req.params?.vendorId);
    if (vendorId) vendorIdsToCheck.push(vendorId);
    try {
      if (options.event) {
        const eventId = Number(source(options.event).eventId);
        if (eventId) {
          const rows = await sequelize.query<{ vendor_id: string | number }>(
            'SELECT vendor_id FROM event WHERE id = :id LIMIT 1',
            { replacements: { id: eventId }, type: QueryTypes.SELECT },
          );
          vendorIdsToCheck.push(Number(rows[0]?.vendor_id));
        }
      }
      if (options.item) {
        const itemId = Number(source(options.item).itemId);
        if (itemId) {
          const rows = await sequelize.query<{ vendor_id: string | number }>(
            `SELECT m.vendor_id FROM line_item i JOIN menu m ON m.id = i.menu_id WHERE i.id = :id LIMIT 1`,
            { replacements: { id: itemId }, type: QueryTypes.SELECT },
          );
          vendorIdsToCheck.push(Number(rows[0]?.vendor_id));
        }
      }
    } catch {
      return res.status(503).json({ error: 'Could not verify vendor workspace access.' });
    }
    if (!vendorId && options.vendorRequired) return res.status(400).json({ error: 'vendorId is required.' });
    if (!vendorIdsToCheck.length || vendorIdsToCheck.some((id) => !allowed.includes(id))) {
      return res.status(403).json({ error: 'Forbidden for this vendor workspace.' });
    }
    next();
  };
}

/**
 * Locks vendor analytics requests to the vendor identity in the verified JWT.
 * Client-supplied vendor, event, and item identifiers are never trusted.
 */
export async function enforceVendorAnalyticsScope(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.user?.role !== 'vendor' || req.method !== 'GET') { next(); return; }
  const vendorId = Number(req.user.vendorId);
  if (!Number.isFinite(vendorId) || vendorId <= 0) {
    res.status(403).json({ error: 'Vendor workspace is missing from this session.' }); return;
  }
  const eventId = Number(req.params.eventId || req.query.eventId || 0);
  const itemId = Number(req.params.itemId || req.query.itemId || 0);
  try {
    if (eventId > 0) {
      const rows = await sequelize.query(
        'SELECT 1 FROM event WHERE id = :eventId AND vendor_id = :vendorId LIMIT 1',
        { replacements: { eventId, vendorId }, type: QueryTypes.SELECT },
      );
      if (!rows.length) { res.status(403).json({ error: 'This event belongs to another vendor workspace.' }); return; }
    }
    if (itemId > 0) {
      const rows = await sequelize.query(
        `SELECT 1 FROM line_item item JOIN menu ON menu.id = item.menu_id
          WHERE item.id = :itemId AND menu.vendor_id = :vendorId LIMIT 1`,
        { replacements: { itemId, vendorId }, type: QueryTypes.SELECT },
      );
      if (!rows.length) { res.status(403).json({ error: 'This item belongs to another vendor workspace.' }); return; }
    }
    next();
  } catch (error) { next(error); }
}
