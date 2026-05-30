/**
 * AuthService — role detection and JWT issuance.
 *
 * Roles:
 *   admin    — phone in ADMIN_PHONES env var (comma-separated)
 *   vendor   — phone matches a vendor.phone record
 *   customer — anyone else (no DB entry created)
 *
 * JWT payload: { phone, role, vendorId? }
 * JWT expiry : 48 hours (configurable via JWT_TTL_HOURS env var)
 */

import jwt from 'jsonwebtoken';
import { Vendor } from '../models/vendor.model';

export type Role = 'admin' | 'vendor' | 'customer';

export interface AuthPayload {
  phone:     string;
  role:      Role;
  vendorId?: number;
}

const JWT_SECRET   = process.env.JWT_SECRET ?? 'peshkash-dev-secret-change-in-prod';
const JWT_TTL_HOURS = Number(process.env.JWT_TTL_HOURS ?? 48);

if (!process.env.JWT_SECRET) {
  console.warn('[AuthService] ⚠️  JWT_SECRET not set — using insecure default. Set JWT_SECRET in .env for production.');
}

function adminPhones(): string[] {
  return (process.env.ADMIN_PHONES ?? '')
    .split(',')
    .map(p => p.trim())
    .filter(Boolean);
}

export const AuthService = {
  /**
   * Determine role from phone number.
   * Checks admin list first, then vendor table, then defaults to customer.
   */
  async resolveRole(phone: string): Promise<AuthPayload> {
    const normalised = phone.replace(/\s/g, '');

    // 1. Admin list
    if (adminPhones().includes(normalised)) {
      return { phone: normalised, role: 'admin' };
    }

    // 2. Vendor table
    try {
      const vendor = await Vendor.findOne({ where: { phone: normalised } });
      if (vendor) {
        return { phone: normalised, role: 'vendor', vendorId: vendor.id };
      }
    } catch {
      // DB unavailable — fall through to customer
    }

    // 3. Customer (no DB record)
    return { phone: normalised, role: 'customer' };
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
