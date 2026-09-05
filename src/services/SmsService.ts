/**
 * SmsService — OTP delivery via a DB-configured SMS provider.
 *
 * Active provider is stored in:
 *   app_config WHERE key = 'sms_provider'  (default: 'fast2sms')
 *
 * To switch provider, run directly in the DB:
 *   UPDATE app_config SET value = 'fast2sms', updated_at = NOW() WHERE key = 'sms_provider';
 *   UPDATE app_config SET value = '2factor',  updated_at = NOW() WHERE key = 'sms_provider';
 *
 * Supported providers:
 *   'fast2sms' — https://fast2sms.com — Quick SMS route (no verification needed)
 *                Cost: ~₹5/SMS. Temporary until WhatsApp OTP is live.
 *                Env var: FAST2SMS_API_KEY
 *   '2factor'  — https://2factor.in  — free 2,000 OTPs (voice only on free tier)
 *                Env var: TWOFACTOR_API_KEY
 *
 * Mock mode: when the active provider's API key is absent, OTP is printed
 * to the server console (safe for local dev).
 *
 * NOTE: Fast2SMS 'otp' route requires Aadhaar KYC + website verification — not done yet.
 *       Using 'q' (Quick SMS) route as temporary workaround. Switch to WhatsApp once
 *       Meta Business account is approved.
 */

import https from 'https';
import { sequelize } from '../config/sequelize';
import { QueryTypes } from 'sequelize';

// ── Provider cache (30s TTL — avoids a DB query on every OTP send) ───────────
let _cachedProvider: string | null = null;
let _cacheExpiry = 0;
const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';

async function getProvider(): Promise<string> {
  if (_cachedProvider && Date.now() < _cacheExpiry) return _cachedProvider;
  try {
    const rows = await sequelize.query<{ value: string }>(
      `SELECT value FROM app_config WHERE key = 'sms_provider' LIMIT 1`,
      { type: QueryTypes.SELECT }
    );
    _cachedProvider = rows[0]?.value ?? 'fast2sms';
  } catch {
    _cachedProvider = 'fast2sms'; // safe default if DB unavailable
  }
  _cacheExpiry = Date.now() + 30_000;
  return _cachedProvider;
}

function to10Digit(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0'))  return digits.slice(1);
  return digits.length === 10 ? digits : digits;
}

// ── Provider implementations ──────────────────────────────────────────────────

async function sendViaFast2Sms(phone: string, otp: string): Promise<void> {
  const apiKey = process.env.FAST2SMS_API_KEY;
  if (!apiKey) {
    if (isProduction) throw new Error('FAST2SMS_API_KEY is not configured.');
    mockLog(phone, otp, 'fast2sms');
    return;
  }

  // Using 'q' (Quick SMS) route — works without KYC/website verification.
  // Custom message supported. Cost: ~₹5/SMS.
  // TODO: Switch to WhatsApp once Meta Business account is approved.
  const message = `Your OTP for Peshkash is ${otp}. Valid for 10 minutes :)`;
  const payload = JSON.stringify({
    route:   'q',
    numbers: to10Digit(phone),
    message,
    flash:   0,
  });

  await new Promise<void>((resolve) => {
    const req = https.request({
      hostname: 'www.fast2sms.com',
      path:     '/dev/bulkV2',
      method:   'POST',
      headers:  {
        authorization:    apiKey,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => {
        try {
          const r = JSON.parse(body);
          if (r.return !== true) console.error('[SmsService] Fast2SMS error:', r.message);
        } catch { /* ignore */ }
        resolve();
      });
    });
    req.on('error', err => { console.error('[SmsService] Fast2SMS request failed:', err.message); resolve(); });
    req.write(payload);
    req.end();
  });
}

async function sendVia2Factor(phone: string, otp: string): Promise<void> {
  const apiKey = process.env.TWOFACTOR_API_KEY;
  if (!apiKey) {
    if (isProduction) throw new Error('TWOFACTOR_API_KEY is not configured.');
    mockLog(phone, otp, '2factor');
    return;
  }

  // 2Factor accepts a caller-generated OTP at this endpoint. Its documented
  // method is POST; GET can return a provider error even though the old client
  // treated the request as delivered.
  const path = `/API/V1/${encodeURIComponent(apiKey)}/SMS/${encodeURIComponent(to10Digit(phone))}/${encodeURIComponent(otp)}`;
  await request2Factor(path);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockLog(phone: string, otp: string, provider: string): void {
  console.log(`\n📱 [SmsService MOCK — ${provider} key not set] To: ${phone}  OTP: ${otp}\n`);
}

async function request2Factor(path: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = https.request({ hostname: '2factor.in', path, method: 'POST', timeout: 15_000 }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`2Factor returned HTTP ${res.statusCode ?? 'unknown'}.`));
          return;
        }
        try {
          const result = JSON.parse(body) as { Status?: string; status?: string; Details?: string; message?: string };
          const status = String(result.Status ?? result.status ?? '').toLowerCase();
          if (status !== 'success' && status !== 'sent') {
            reject(new Error(`2Factor rejected OTP delivery: ${result.Details ?? result.message ?? 'unknown error'}`));
            return;
          }
          resolve();
        } catch (error) {
          reject(error instanceof Error ? error : new Error('Invalid response from 2Factor.'));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('2Factor request timed out.')));
    req.on('error', reject);
    req.end();
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export const SmsService = {
  async send(phone: string, otp: string): Promise<void> {
    const provider = await getProvider();
    switch (provider) {
      case '2factor':  return sendVia2Factor(phone, otp);
      case 'fast2sms':
      default:         return sendViaFast2Sms(phone, otp);
    }
  },
};
