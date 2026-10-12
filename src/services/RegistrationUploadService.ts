import crypto from 'crypto';
import WebSocket from 'ws';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from './EventRegistrationService';

/**
 * Files guests attach to registration / feedback answers. They go to a PRIVATE Supabase bucket
 * (unlike public item images); vendors read them through short-lived signed links.
 * Path layout: <eventId>/<phoneDigits>/<random>.<ext> — the answer validator only accepts paths
 * under the caller's own folder, so a guest can never attach someone else's file.
 */
export const REGISTRATION_BUCKET = process.env.SUPABASE_REGISTRATION_BUCKET || 'registration-uploads';
const MAX_BYTES = 8 * 1024 * 1024;

let client: SupabaseClient | null = null;
let bucketReady: Promise<void> | null = null;

function supabase(): SupabaseClient {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) throw new HttpError(503, 'File uploads are not configured on the server.');
  client ??= createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { realtime: { transport: WebSocket as any } });
  return client;
}

async function ensureBucket(): Promise<void> {
  bucketReady ??= (async () => {
    const sb = supabase();
    const { data } = await sb.storage.getBucket(REGISTRATION_BUCKET);
    if (!data) {
      const { error } = await sb.storage.createBucket(REGISTRATION_BUCKET, { public: false, fileSizeLimit: MAX_BYTES });
      if (error && !/exists/i.test(error.message)) { bucketReady = null; throw new HttpError(503, `Upload storage unavailable: ${error.message}`); }
    }
  })();
  return bucketReady;
}

const SIGNATURES: Record<string, (b: Buffer) => boolean> = {
  'image/jpeg': (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
  'application/pdf': (b) => b.length >= 5 && b.toString('ascii', 0, 5) === '%PDF-',
};
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

export function detectUploadType(file: { buffer: Buffer; mimetype: string }): string | null {
  return SIGNATURES[file.mimetype]?.(file.buffer) ? file.mimetype : null;
}

export const RegistrationUploadService = {
  async upload(eventId: number, phone: string, file: Express.Multer.File) {
    if (!file) throw new HttpError(400, 'No file provided.');
    if (file.size > MAX_BYTES) throw new HttpError(400, 'Files must be 8 MB or smaller.');
    const type = detectUploadType(file);
    if (!type) throw new HttpError(400, 'Upload a JPG, PNG, WebP or PDF file.');
    await ensureBucket();
    const path = `${eventId}/${phone.replace(/\D/g, '')}/${crypto.randomBytes(9).toString('base64url')}.${EXT[type]}`;
    const { error } = await supabase().storage.from(REGISTRATION_BUCKET).upload(path, file.buffer, { contentType: type, upsert: false });
    if (error) throw new HttpError(502, `Upload failed: ${error.message}`);
    return { path, name: String(file.originalname || `upload.${EXT[type]}`).slice(0, 200), size: file.size, type };
  },

  async signedUrl(eventId: number, path: string) {
    if (!path.startsWith(`${eventId}/`) || path.includes('..')) throw new HttpError(404, 'File not found.');
    const { data, error } = await supabase().storage.from(REGISTRATION_BUCKET).createSignedUrl(path, 600);
    if (error || !data?.signedUrl) throw new HttpError(404, 'File not found.');
    return { url: data.signedUrl, expiresIn: 600 };
  },
};
