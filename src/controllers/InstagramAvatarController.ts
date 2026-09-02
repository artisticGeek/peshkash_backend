import { Request, Response } from 'express';

type CachedAvatar = {
  expiresAt: number;
  contentType?: string;
  image?: Buffer;
};

const avatarCache = new Map<string, CachedAvatar>();
const USERNAME_PATTERN = /^[a-zA-Z0-9._]{1,30}$/;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const SUCCESS_TTL_MS = 6 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 15 * 60 * 1000;

function decodeHtmlAttribute(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

export function instagramOgImage(html: string) {
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtmlAttribute(match[1]);
  }
  return null;
}

function trustedInstagramImage(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && (host.endsWith('.cdninstagram.com') || host.endsWith('.fbcdn.net')) ? url.toString() : null;
  } catch {
    return null;
  }
}

async function fetchInstagramAvatar(username: string) {
  const profileResponse = await fetch(`https://www.instagram.com/${encodeURIComponent(username)}/`, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'Mozilla/5.0 (compatible; PeshkashPreview/1.0; +https://peshkash.app)',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(6000),
  });
  if (!profileResponse.ok) throw new Error(`Instagram profile returned ${profileResponse.status}`);
  const html = (await profileResponse.text()).slice(0, 2_000_000);
  const imageUrl = instagramOgImage(html);
  const trustedUrl = imageUrl ? trustedInstagramImage(imageUrl) : null;
  if (!trustedUrl) throw new Error('Instagram profile image was unavailable');

  const imageResponse = await fetch(trustedUrl, {
    headers: { Accept: 'image/avif,image/webp,image/jpeg,image/png' },
    redirect: 'follow',
    signal: AbortSignal.timeout(6000),
  });
  if (!imageResponse.ok) throw new Error(`Instagram image returned ${imageResponse.status}`);
  const contentType = (imageResponse.headers.get('content-type') || '').split(';')[0].toLowerCase();
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(contentType)) throw new Error('Instagram image type was unsupported');
  const image = Buffer.from(await imageResponse.arrayBuffer());
  if (!image.length || image.length > MAX_IMAGE_BYTES) throw new Error('Instagram image exceeded the size limit');
  return { contentType, image };
}

export const InstagramAvatarController = {
  get: async (req: Request, res: Response) => {
    const username = String(req.params.username || '').trim().replace(/^@/, '').toLowerCase();
    if (!USERNAME_PATTERN.test(username)) return res.status(404).send('Avatar not found');

    const cached = avatarCache.get(username);
    if (cached && cached.expiresAt > Date.now()) {
      if (!cached.image || !cached.contentType) return res.status(404).send('Avatar not found');
      res.set('Cache-Control', 'public, max-age=21600, stale-while-revalidate=86400');
      res.set('Content-Type', cached.contentType);
      return res.status(200).send(cached.image);
    }

    try {
      const avatar = await fetchInstagramAvatar(username);
      if (avatarCache.size >= 200) avatarCache.delete(avatarCache.keys().next().value as string);
      avatarCache.set(username, { ...avatar, expiresAt: Date.now() + SUCCESS_TTL_MS });
      res.set('Cache-Control', 'public, max-age=21600, stale-while-revalidate=86400');
      res.set('Content-Type', avatar.contentType);
      return res.status(200).send(avatar.image);
    } catch (error) {
      avatarCache.set(username, { expiresAt: Date.now() + FAILURE_TTL_MS });
      console.warn(`[InstagramAvatar] ${username}:`, error instanceof Error ? error.message : error);
      res.set('Cache-Control', 'public, max-age=900');
      return res.status(404).send('Avatar not found');
    }
  },
};
