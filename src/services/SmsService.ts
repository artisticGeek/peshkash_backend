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
  if (!apiKey) { mockLog(phone, otp, 'fast2sms'); return; }

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
  if (!apiKey) { mockLog(phone, otp, '2factor'); return; }

  // No /AUTOGEN suffix — that flag tells 2factor to generate its own OTP.
  // We pass our own OTP, so just use the plain SMS endpoint.
  const path = `/API/V1/${apiKey}/SMS/${to10Digit(phone)}/${otp}`;
  await httpGet('2factor.in', path, '2Factor');
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
      case '2factor':  return sendVia2Factor(phone, otp);
      case 'fast2sms':
      default:         return sendViaFast2Sms(phone, otp);
    }
  },
};
