/**
 * AuthService — role detection and JWT issuance.
 *
 * Roles:
 *   admin    — phone in the admin_user table (managed via admin API)
 *   vendor   — phone matches a vendor.phone record
 *   customer — anyone else (no DB entry created)
 *
 * Bootstrap: set INITIAL_ADMIN_PHONE env var to seed the first admin on first boot.
 *
 * JWT payload: { phone, role, vendorId? }
 * JWT expiry : 8760 h / 1 year (configurable via JWT_TTL_HOURS env var).
 *   The frontend enforces a shorter 90-day sliding window. The long-lived
 *   token means active users are never forced to re-authenticate just because
 *   the JWT expired while the frontend still considers the session live.
 */

import jwt from 'jsonwebtoken';
import { Vendor } from '../models/vendor.model';
import { sequelize } from '../config/sequelize';
import { QueryTypes } from 'sequelize';

export type Role = 'admin' | 'vendor' | 'customer';

export interface AuthPayload {
  phone:     string;
  role:      Role;
  vendorId?: number | null;
  vendorIds?: number[];
  // UI convenience only — which dashboard sections to render. NEVER the authorization
  // source: every admin route re-checks admin_section_grant live (see requireSection in
  // authMiddleware.ts), because a token can live up to a year and grants must be
  // revocable immediately by editing a DB row.
  sectionGrants?: string[];
  iat?:      number; // JWT standard claim — seconds since epoch
  exp?:      number; // JWT standard claim
}

const JWT_SECRET    = process.env.JWT_SECRET ?? 'peshkash-dev-secret-change-in-prod';
const JWT_TTL_HOURS = Number(process.env.JWT_TTL_HOURS ?? 8760); // 1 year

if (!process.env.JWT_SECRET) {
  console.warn('[AuthService] ⚠️  JWT_SECRET not set — using insecure default. Set JWT_SECRET in production.');
}

export const AuthService = {
  /**
   * Determine role from phone number.
   * Checks admin_user table first, then vendor table, then defaults to customer.
   */
  async resolveRole(phone: string): Promise<AuthPayload> {
    const normalised = phone.replace(/\s/g, '');

    // 1. Admin table — admins are superusers: all vendors and all sections.
    try {
      const rows = await sequelize.query<{ phone: string }>(
        'SELECT phone FROM admin_user WHERE phone = :phone LIMIT 1',
        { replacements: { phone: normalised }, type: QueryTypes.SELECT }
      );
      if (rows.length > 0) {
        return { phone: normalised, role: 'admin', vendorId: null, vendorIds: [], sectionGrants: ALL_SECTIONS };
      }
    } catch {
      // Table might not exist yet on first boot — fall through
    }

    // 2. Vendor table. A phone may own more than one vendor workspace; the
    // legacy vendorId claim remains as the default/first workspace.
    try {
      const vendors = await Vendor.findAll({ where: { phone: normalised }, attributes: ['id'], order: [['id', 'ASC']] });
      if (vendors.length) {
        let sectionGrants: string[] = [];
        try {
          const grants = await sequelize.query<{ section: string }>(
            'SELECT section FROM admin_section_grant WHERE phone = :phone',
            { replacements: { phone: normalised }, type: QueryTypes.SELECT }
          );
          sectionGrants = grants.map((g) => g.section);
        } catch {
          // Table might not exist yet on first boot — return no grants.
        }
        const vendorIds = vendors.map((vendor) => Number(vendor.id));
        return { phone: normalised, role: 'vendor', vendorId: vendorIds[0], vendorIds, sectionGrants };
      }
    } catch {
      // DB unavailable — fall through to customer
    }

    // 3. Customer (no DB record)
    return { phone: normalised, role: 'customer', vendorId: null };
  },

  /** Sign a JWT with the given payload. */
  signToken(payload: AuthPayload): string {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: `${JWT_TTL_HOURS}h` });
  },

  /** Verify and decode a JWT. Returns null if invalid/expired. */
  verifyToken(token: string): AuthPayload | null {
    try {
      return jwt.verify(token, JWT_SECRET) as AuthPayload;
    } catch {
      return null;
    }
  },
};

export const ALL_SECTIONS = [
  'home', 'vendors', 'events', 'designer', 'qr', 'qr-templates', 'resources', 'insights', 'engagement', 'sessions',
];
