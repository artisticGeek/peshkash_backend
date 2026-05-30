/**
 * SmsService — OTP delivery via a DB-configured SMS provider.
 *
 * Active provider is stored in:
 *   app_config WHERE key = 'sms_provider'  (default: '2factor')
 *
 * To switch provider, run directly in the DB:
 *   UPDATE app_config SET value = 'fast2sms', updated_at = NOW() WHERE key = 'sms_provider';
 *   UPDATE app_config SET value = '2factor',  updated_at = NOW() WHERE key = 'sms_provider';
 *
 * Supported providers:
 *   '2factor'  — https://2factor.in  — free 2,000 OTPs, no payment required
 *                Env var: TWOFACTOR_API_KEY
 *   'fast2sms' — https://fast2sms.com — requires Rs.100 recharge
 *                Env var: FAST2SMS_API_KEY
 *
 * Mock mode: when the active provider's API key is absent, OTP is printed
 * to the server console (safe for local dev).
 */

import https from 'https';
import { sequelize } from '../config/sequelize';
import { QueryTypes } from 'sequelize';

// ── Provider cache (30s TTL — avoids a DB query on every OTP send) ───────────
let _cachedProvider: string | null = null;
let _cacheExpiry = 0;

async function getProvider(): Promise<string> {
  if (_cachedProvider && Date.now() < _cacheExpiry) return _cachedProvider;
  try {
    const rows = await sequelize.query<{ value: string }>(
      `SELECT value FROM app_config WHERE key = 'sms_provider' LIMIT 1`,
      { type: QueryTypes.SELECT }
    );
    _cachedProvider = rows[0]?.value ?? '2factor';
  } catch {
    _cachedProvider = '2factor'; // safe default if DB unavailable
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

async function sendVia2Factor(phone: string, otp: string): Promise<void> {
  const apiKey = process.env.TWOFACTOR_API_KEY;
  if (!apiKey) { mockLog(phone, otp, '2factor'); return; }

  const path = `/API/V1/${apiKey}/SMS/${to10Digit(phone)}/${otp}/AUTOGEN`;
  await httpGet('2factor.in', path, '2Factor');
}

async function sendViaFast2Sms(phone: string, otp: string): Promise<void> {
  const apiKey = process.env.FAST2SMS_API_KEY;
  if (!apiKey) { mockLog(phone, otp, 'fast2sms'); return; }

  const message = `Your Peshkash OTP is ${otp}. Valid for 10 minutes.`;
  const payload = JSON.stringify({ route: 'q', numbers: to10Digit(phone), message, flash: 0 });

  await new Promise<void>((resolve) => {
    const req = https.request({
      hostname: 'www.fast2sms.com',
      path:     '/dev/bulkV2',
      method:   'POST',
      headers:  {
        authorization: apiKey,
        'Content-Type': 'application/json',
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockLog(phone: string, otp: string, provider: string): void {
  console.log(`\n📱 [SmsService MOCK — ${provider} key not set] To: ${phone}  OTP: ${otp}\n`);
}

async function httpGet(hostname: string, path: string, label: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const req = https.request({ hostname, path, method: 'GET' }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => {
        try {
          const r = JSON.parse(body);
          if (r.Status && r.Status !== 'Success') console.error(`[SmsService] ${label} error:`, r.Details);
        } catch { /* ignore */ }
        resolve();
      });
    });
    req.on('error', err => { console.error(`[SmsService] ${label} request failed:`, err.message); resolve(); });
    req.end();
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export const SmsService = {
  async send(phone: string, otp: string): Promise<void> {
    const provider = await getProvider();
    switch (provider) {
      case 'fast2sms': return sendViaFast2Sms(phone, otp);
      case '2factor':
      default:         return sendVia2Factor(phone, otp);
    }
  },
};
