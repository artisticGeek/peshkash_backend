import { Request, Response } from 'express';
import { QueryTypes } from 'sequelize';
import { OtpService } from '../services/OtpService';
import { AuthService } from '../services/AuthService';
import { DeviceLinkService } from '../services/DeviceLinkService';
import { sequelize } from '../config/sequelize';

/** Normalise phone: strip spaces, ensure +91 prefix for Indian numbers */
function normalisePhone(raw: string): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  // Accept 10-digit Indian, 12-digit with country code, or full intl
  if (digits.length === 10) return '+91' + digits;
  if (digits.length === 12 && digits.startsWith('91')) return '+' + digits;
  if (digits.length > 7)   return '+' + digits; // other international
  return null;
}

export const AuthController = {
  /**
   * POST /api/auth/send-otp
   * Body: { phone: string }
   */
  sendOtp: async (req: Request, res: Response) => {
    const phone = normalisePhone(req.body?.phone ?? '');
    if (!phone) {
      return res.status(400).json({ error: 'Invalid phone number.' });
    }

    try {
      await OtpService.sendOtp(phone);
      return res.json({ ok: true, message: 'OTP sent.' });
    } catch (err: any) {
      console.error('[Auth] sendOtp error:', err?.message);
      return res.status(500).json({ error: 'Could not send OTP. Try again.' });
    }
  },

  /**
   * POST /api/auth/verify-otp
   * Body: { phone: string, otp: string }
   * Returns: { token, role, vendorId?, phone }
   */
  verifyOtp: async (req: Request, res: Response) => {
    const phone = normalisePhone(req.body?.phone ?? '');
    const otp   = String(req.body?.otp ?? '').trim();

    if (!phone || !otp || otp.length !== 6) {
      return res.status(400).json({ error: 'Phone and 6-digit OTP are required.' });
    }

    try {
      const valid = await OtpService.verifyOtp(phone, otp);
      if (!valid) {
        return res.status(401).json({ error: 'Invalid or expired OTP.' });
      }

      const payload = await AuthService.resolveRole(phone);
      const token   = AuthService.signToken(payload);

      // The only place a device gets linked to a phone — driven by a verified OTP,
      // never by a client-supplied pairing. Best-effort: never blocks the response.
      const deviceId = req.body?.deviceId;
      if (deviceId) DeviceLinkService.link(deviceId, phone).catch(() => {});

      return res.json({
        token,
        role:          payload.role,
        vendorId:      payload.vendorId ?? null,
        phone:         payload.phone,
        sectionGrants: payload.sectionGrants ?? [],
      });
    } catch (err: any) {
      console.error('[Auth] verifyOtp error:', err?.message);
      return res.status(500).json({ error: 'Verification failed. Try again.' });
    }
  },

  /**
   * GET /api/auth/me
   * Returns current identity from Bearer token without hitting DB.
   */
  me: async (req: Request, res: Response) => {
    const header = req.headers.authorization ?? '';
    const token  = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'No token.' });

    const payload = AuthService.verifyToken(token);
    if (!payload) return res.status(401).json({ error: 'Token invalid or expired.' });

    return res.json(payload);
  },

  // ── Admin user management ──────────────────────────────────────────────────

  /**
   * GET /api/admin/admin-users
   * Returns all admin phones. Requires admin role.
   */
  listAdminUsers: async (_req: Request, res: Response) => {
    try {
      const rows = await sequelize.query<{ phone: string; created_at: string }>(
        'SELECT phone, created_at FROM admin_user ORDER BY created_at',
        { type: QueryTypes.SELECT }
      );
      return res.json(rows);
    } catch (err: any) {
      return res.status(500).json({ error: 'Could not list admin users.' });
    }
  },

  /**
   * POST /api/admin/admin-users
   * Body: { phone: string }
   * Adds a phone as admin. Requires admin role.
   */
  addAdminUser: async (req: Request, res: Response) => {
    const phone = normalisePhone(req.body?.phone ?? '');
    if (!phone) return res.status(400).json({ error: 'Invalid phone number.' });

    try {
      await sequelize.query(
        'INSERT INTO admin_user (phone) VALUES (:phone) ON CONFLICT (phone) DO NOTHING',
        { replacements: { phone } }
      );
      return res.json({ ok: true, phone });
    } catch (err: any) {
      return res.status(500).json({ error: 'Could not add admin user.' });
    }
  },

  /**
   * DELETE /api/admin/admin-users/:phone
   * Removes an admin phone. Requires admin role.
   * Safety: cannot remove yourself.
   */
  removeAdminUser: async (req: Request, res: Response) => {
    const phone = decodeURIComponent(req.params.phone);
    const self  = (req as any).user?.phone;

    if (phone === self) {
      return res.status(400).json({ error: 'Cannot remove your own admin access.' });
    }

    try {
      await sequelize.query(
        'DELETE FROM admin_user WHERE phone = :phone',
        { replacements: { phone } }
      );
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: 'Could not remove admin user.' });
    }
  },

  // ── Admin section grants ─────────────────────────────────────────────────────
  // Flat list of dashboard sections per admin — no role hierarchy. Re-checked live
  // on every admin request by requireSection() in authMiddleware.ts; what's returned
  // here is only ever used to render the grants editor and the nav.

  /**
   * GET /api/admin/section-grants?phone=X
   */
  listSectionGrants: async (req: Request, res: Response) => {
    const phone = normalisePhone(String(req.query.phone ?? ''));
    if (!phone) return res.status(400).json({ error: 'Invalid phone number.' });

    try {
      const rows = await sequelize.query<{ section: string }>(
        'SELECT section FROM admin_section_grant WHERE phone = :phone ORDER BY section',
        { replacements: { phone }, type: QueryTypes.SELECT }
      );
      return res.json({ phone, sections: rows.map((r) => r.section) });
    } catch (err: any) {
      return res.status(500).json({ error: 'Could not list section grants.' });
    }
  },

  /**
   * PUT /api/admin/section-grants
   * Body: { phone: string, sections: string[] }
   * Replaces the full grant set for one admin.
   */
  setSectionGrants: async (req: Request, res: Response) => {
    const phone = normalisePhone(req.body?.phone ?? '');
    const sections = Array.isArray(req.body?.sections)
      ? req.body.sections.filter((s: unknown) => typeof s === 'string' && GRANTABLE_SECTIONS.has(s))
      : null;
    if (!phone) return res.status(400).json({ error: 'Invalid phone number.' });
    if (!sections) return res.status(400).json({ error: 'sections must be an array of section keys.' });

    try {
      await sequelize.transaction(async (t) => {
        await sequelize.query('DELETE FROM admin_section_grant WHERE phone = :phone', { replacements: { phone }, transaction: t });
        for (const section of sections) {
          await sequelize.query(
            'INSERT INTO admin_section_grant (phone, section) VALUES (:phone, :section) ON CONFLICT DO NOTHING',
            { replacements: { phone, section }, transaction: t }
          );
        }
      });
      return res.json({ ok: true, phone, sections });
    } catch (err: any) {
      return res.status(500).json({ error: 'Could not update section grants.' });
    }
  },
};

const GRANTABLE_SECTIONS = new Set([
  'vendors', 'events', 'designer', 'qr', 'qr-templates', 'resources', 'insights', 'engagement', 'sessions',
]);
