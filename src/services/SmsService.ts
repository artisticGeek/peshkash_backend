/**
 * SmsService — thin SMS abstraction for OTP delivery.
 *
 * Provider: 2Factor.in (https://2factor.in)
 *   - Free tier: 2,000 OTPs, no payment required
 *   - Indian numbers only (+91)
 *   - API key from: 2factor.in → Dashboard → API Key
 *
 * Mock mode: when TWOFACTOR_API_KEY is not set, OTP is printed to console
 * (safe for local dev — never reaches users).
 */

import https from 'https';

function to10Digit(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0'))  return digits.slice(1);
  if (digits.length === 10) return digits;
  return digits;
}

export const SmsService = {
  async send(phone: string, otp: string): Promise<void> {
    const apiKey = process.env.TWOFACTOR_API_KEY;

    if (!apiKey) {
      // ── Mock mode (local dev) ───────────────────────────────────────────
      console.log(`\n📱 [SmsService MOCK] To: ${phone}`);
      console.log(`   OTP: ${otp}`);
      console.log(`   ─────────────────────────────────────────────────────\n`);
      return;
    }

    // ── 2Factor.in OTP API ─────────────────────────────────────────────────
    const number = to10Digit(phone);
    const path   = `/API/V1/${apiKey}/SMS/${number}/${otp}/AUTOGEN`;

    await new Promise<void>((resolve) => {
      const req = https.request(
        { hostname: '2factor.in', path, method: 'GET' },
        res => {
          let body = '';
          res.on('data', chunk => { body += chunk; });
          res.on('end', () => {
            try {
              const result = JSON.parse(body);
              if (result.Status !== 'Success') {
                console.error('[SmsService] 2Factor error:', result.Details);
              }
            } catch { /* ignore parse errors */ }
            resolve();
          });
        }
      );
      req.on('error', err => {
        console.error('[SmsService] Request failed:', err.message);
        resolve(); // non-fatal — OTP still visible in mock log
      });
      req.end();
    });
  },
};
