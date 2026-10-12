import crypto from 'crypto';

/**
 * Pass and invitation tokens.
 *
 * A token is 128 bits derived with HMAC from a server secret and a random per-row nonce, so:
 *   - it cannot be guessed (2^128 space) or enumerated (no sequential ids in it);
 *   - only its SHA-256 hash is stored and used for lookups;
 *   - the owner (or the vendor) can still be shown their link again, because the server can
 *     re-derive it from the stored nonce;
 *   - re-issuing (a new nonce) kills the old link immediately.
 */

function secret(): string {
  return process.env.PASS_TOKEN_SECRET || process.env.JWT_SECRET || 'peshkash-dev-secret-change-in-prod';
}

export function newNonce(): string {
  return crypto.randomBytes(16).toString('base64url');
}

export function deriveToken(kind: 'pass' | 'invite', rowId: number | string, nonce: string): string {
  return crypto.createHmac('sha256', secret()).update(`${kind}.${rowId}.${nonce}`).digest().subarray(0, 16).toString('base64url');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/** Accepts a bare token or any URL ending in /t/<token> or /i/<token>. */
export function extractToken(input: unknown): string | null {
  const raw = String(input ?? '').trim();
  const match = raw.match(/([A-Za-z0-9_-]{22})(?:[/?#].*)?$/);
  return match ? match[1] : null;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Short, human-readable code printed on passes, e.g. "DTE-7F3K". Display only — never a credential. */
export function passCode(eventLabel: string, tokenHash: string): string {
  const prefix = (String(eventLabel).match(/[A-Za-z0-9]+/g) ?? ['EVT'])
    .map((word) => word[0]).join('').toUpperCase().slice(0, 3).padEnd(3, 'X');
  let suffix = '';
  for (let i = 0; i < 4; i += 1) suffix += CROCKFORD[parseInt(tokenHash.slice(i * 2, i * 2 + 2), 16) % 32];
  return `${prefix}-${suffix}`;
}
