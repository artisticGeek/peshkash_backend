import { Request, Response } from 'express';
import { OtpService } from '../services/OtpService';
import { AuthService } from '../services/AuthService';

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
   * Rate-limit is handled at the OtpService level (Redis TTL).
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
   * Returns: { token, role, vendorId? }
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

      return res.json({
        token,
        role:     payload.role,
        vendorId: payload.vendorId ?? null,
        phone:    payload.phone,
      });
    } catch (err: any) {
      console.error('[Auth] verifyOtp error:', err?.message);
      return res.status(500).json({ error: 'Verification failed. Try again.' });
    }
  },

  /**
   * GET /api/auth/me
   * Reads the Bearer token from Authorization header.
   * Returns current identity without hitting DB.
   */
  me: async (req: Request, res: Response) => {
    const header = req.headers.authorization ?? '';
    const token  = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'No token.' });

    const payload = AuthService.verifyToken(token);
    if (!payload) return res.status(401).json({ error: 'Token invalid or expired.' });

    return res.json(payload);
  },
};
