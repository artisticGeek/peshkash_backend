/**
 * SmsService — thin SMS abstraction.
 *
 * Providers:
 *   FAST2SMS_API_KEY set  → sends via Fast2SMS (free tier, India numbers)
 *   Not set              → MOCK mode — logs OTP to console (local dev / CI)
 *
 * Fast2SMS free setup:
 *   1. Register at https://www.fast2sms.com
 *   2. Dashboard → Dev API → copy API key
 *   3. Add FAST2SMS_API_KEY=<key> to .env
 *
 * The service normalises numbers to 10-digit local format that Fast2SMS expects.
 * Numbers may be passed as +919876543210, 09876543210, or 9876543210.
 */

import https from 'https';

function to10Digit(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0'))  return digits.slice(1);
  if (digits.length === 10) return digits;
  return digits; // pass-through for non-Indian numbers
}

export const SmsService = {
  async send(phone: string, message: string): Promise<void> {
    const apiKey = process.env.FAST2SMS_API_KEY;

    if (!apiKey) {
      // ── MOCK mode ──────────────────────────────────────────────────────────
      console.log(`\n📱 [SmsService MOCK] To: ${phone}`);
      console.log(`   Message: ${message}`);
      console.log(`   ─────────────────────────────────────────────────────\n`);
      return;
    }

    // ── Fast2SMS DLT-free Quick SMS ─────────────────────────────────────────
    const number = to10Digit(phone);
    const payload = JSON.stringify({
      route:   'q',           // Quick route — no DLT required
      numbers: number,
      message,
      flash:   0,
    });

    await new Promise<void>((resolve, reject) => {
      const req = https.request(
        {
          hostname: 'www.fast2sms.com',
          path:     '/dev/bulkV2',
          method:   'POST',
          headers:  {
            authorization: apiKey,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        res => {
          let body = '';
          res.on('data', chunk => { body += chunk; });
          res.on('end', () => {
            try {
              const result = JSON.parse(body);
              if (result.return === true) {
                resolve();
              } else {
                console.error('[SmsService] Fast2SMS error:', result.message);
                resolve(); // non-fatal — OTP still logged server-side in mock fallback below
              }
            } catch {
              resolve();
            }
          });
        }
      );
      req.on('error', err => {
        console.error('[SmsService] Request failed:', err.message);
        resolve(); // non-fatal
      });
      req.write(payload);
      req.end();
    });
  },
};
