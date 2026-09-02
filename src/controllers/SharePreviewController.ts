import { Request, Response } from 'express';
import { Event } from '../models/event.model';
import { Vendor } from '../models/vendor.model';
import { VendorRepo } from '../repositories/vendor.repository';
import { EventMenuMappingService } from '../services/EventMenuMappingService';
import { resolveSocialPreview, ResolvedSocialPreview, SocialPreviewConfig } from '../services/SocialPreviewService';
import { MapperUtil } from '../utils/MapperUtil';

const PUBLIC_ORIGIN = (process.env.PUBLIC_APP_ORIGIN || 'https://peshkash.app').replace(/\/$/, '');
const PUBLIC_API_ORIGIN = (process.env.PUBLIC_API_ORIGIN || 'https://peshkash-backend.onrender.com').replace(/\/$/, '');
const FALLBACK_IMAGE = `${PUBLIC_ORIGIN}/brand/social/peshkash-home-preview.jpg`;
const EXHIBITS_IMAGE = `${PUBLIC_ORIGIN}/brand/social/peshkash-exhibits-preview.jpg`;
const SHOWROOMS_IMAGE = `${PUBLIC_ORIGIN}/brand/social/peshkash-showrooms-preview.png`;

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function cleanDescription(value: unknown, fallback: string) {
  return String(value || fallback).replace(/\s+/g, ' ').trim().slice(0, 220);
}

export function previewDocument(input: ResolvedSocialPreview) {
  const title = escapeHtml(input.title);
  const description = escapeHtml(input.description);
  const target = escapeHtml(input.targetUrl);
  const image = escapeHtml(input.imageUrl);
  const imageAlt = escapeHtml(input.imageAlt);
  const targetJson = JSON.stringify(input.targetUrl).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <meta property="og:site_name" content="Peshkash">
  <meta property="og:type" content="${escapeHtml(input.type)}">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:url" content="${target}">
  <meta property="og:image" content="${image}">
  <meta property="og:image:secure_url" content="${image}">
  <meta property="og:image:type" content="${escapeHtml(input.imageType)}">
  <meta property="og:image:width" content="${input.imageWidth}">
  <meta property="og:image:height" content="${input.imageHeight}">
  <meta property="og:image:alt" content="${imageAlt}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:image" content="${image}">
  <meta name="twitter:image:alt" content="${imageAlt}">
  <link rel="canonical" href="${target}">
  <meta http-equiv="refresh" content="0;url=${target}">
  <style>body{background:#f5efe6;color:#1a1410;font-family:system-ui,sans-serif;display:grid;min-height:100vh;margin:0;place-items:center;text-align:center}a{color:#956a36}</style>
</head>
<body><main><p>Opening <strong>${title}</strong>…</p><a href="${target}">Continue to Peshkash</a></main><script>window.location.replace(${targetJson});</script></body>
</html>`;
}

function sendPreview(res: Response, input: Parameters<typeof resolveSocialPreview>[0]) {
  const resolved = resolveSocialPreview(input);
  res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=86400');
  res.set('X-Social-Preview-Source', resolved.source);
  res.set('X-Social-Preview-Version', String(resolved.version));
  return res.status(200).type('html').send(previewDocument(resolved));
}

function unavailable(res: Response) {
  return sendPreview(res, {
    title: 'Discover on Peshkash',
    description: 'A digital shop window for products, collections, vendors and events.',
    targetUrl: PUBLIC_ORIGIN,
    imageAlt: 'Peshkash — your shop window, digitally',
    fallbackImageUrl: FALLBACK_IMAGE,
  });
}

function eventContext(event: Event) {
  const config = (event.experienceConfig || {}) as Record<string, any>;
  const parts: string[] = [];
  if (event.startTime) parts.push(new Intl.DateTimeFormat('en-IN', { dateStyle: 'long', timeZone: 'Asia/Kolkata' }).format(new Date(event.startTime)));
  if (config.venueName) parts.push(String(config.venueName));
  return parts.join(' · ');
}

function firstMenuImage(items: any[]): string | undefined {
  for (const item of items || []) {
    if (item?.image) return item.image;
    const nested = firstMenuImage(item?.subCategoryLineItems || []);
    if (nested) return nested;
  }
  return undefined;
}

export const SharePreviewController = {
  home: async (_req: Request, res: Response) => sendPreview(res, {
    title: 'Peshkash — Your shop window, digitally',
    description: 'Create a digital presence people can open, save and share from one permanent QR.',
    targetUrl: PUBLIC_ORIGIN,
    imageAlt: 'Peshkash — your shop window, digitally',
    fallbackImageUrl: FALLBACK_IMAGE,
  }),

  exhibits: async (_req: Request, res: Response) => sendPreview(res, {
    title: 'Peshkash for exhibitions',
    description: 'Every stall. Still discoverable. Connect every exhibitor, visitor scan and follow-up action with Peshkash.',
    targetUrl: `${PUBLIC_ORIGIN}/exhibits`,
    type: 'article',
    imageAlt: 'Peshkash for exhibitions — every stall, still discoverable',
    fallbackImageUrl: FALLBACK_IMAGE,
    candidates: [{ url: EXHIBITS_IMAGE, source: 'hero' }],
  }),

  showrooms: async (_req: Request, res: Response) => sendPreview(res, {
    title: 'Peshkash for showrooms',
    description: 'Your showroom needs a memory. Make products discoverable, customer interest measurable and follow-up informed.',
    targetUrl: `${PUBLIC_ORIGIN}/showrooms`,
    type: 'article',
    imageAlt: 'Peshkash for showrooms — your showroom needs a memory',
    fallbackImageUrl: FALLBACK_IMAGE,
    candidates: [{ url: SHOWROOMS_IMAGE, source: 'hero' }],
  }),

  vendor: async (req: Request, res: Response) => {
    try {
      const vendor = await VendorRepo.getByName(req.params.vendorName);
      if (!vendor?.hasContactPage) return unavailable(res);
      const generatedImage = `${PUBLIC_API_ORIGIN}/api/social-previews/vendor/${encodeURIComponent(vendor.name)}/v1.jpg`;
      return sendPreview(res, {
        title: vendor.displayName,
        description: cleanDescription(vendor.description, `Meet ${vendor.displayName}, explore their story and save their details on Peshkash.`),
        targetUrl: `${PUBLIC_ORIGIN}/vendor/${encodeURIComponent(vendor.name)}`,
        type: 'profile',
        imageAlt: `${vendor.displayName} profile on Peshkash`,
        fallbackImageUrl: FALLBACK_IMAGE,
        candidates: [
          { url: generatedImage, source: 'generated' },
          { url: vendor.logoUrl, source: 'hero' },
        ],
      });
    } catch { return unavailable(res); }
  },

  event: async (req: Request, res: Response) => {
    try {
      const event = await Event.findOne({ where: { name: req.params.eventName }, include: [Vendor] });
      const config = (event?.experienceConfig || {}) as Record<string, any>;
      if (!event || !config.enabled || event.status !== 'active') return unavailable(res);
      const context = eventContext(event);
      const fallbackDescription = `Discover ${event.displayName}, event details, guests and reminders on Peshkash.`;
      const description = [cleanDescription(event.eventDescription, fallbackDescription), context].filter(Boolean).join(' · ').slice(0, 220);
      const previewVersion = Math.max(1, Math.floor(Number(config.socialPreview?.version) || 1));
      const generatedImage = `${PUBLIC_API_ORIGIN}/api/social-previews/event/${encodeURIComponent(event.name)}/v${previewVersion}.jpg`;
      return sendPreview(res, {
        title: event.displayName,
        description,
        targetUrl: `${PUBLIC_ORIGIN}/event/${encodeURIComponent(event.name)}`,
        type: 'article',
        imageAlt: [event.displayName, context].filter(Boolean).join(' — '),
        fallbackImageUrl: FALLBACK_IMAGE,
        config: config.socialPreview as SocialPreviewConfig,
        candidates: [
          { url: generatedImage, source: 'generated' },
          { url: config.heroImageUrl, source: 'hero' },
          { url: event.vendor?.logoUrl, source: 'hero' },
        ],
      });
    } catch { return unavailable(res); }
  },

  menu: async (req: Request, res: Response) => {
    try {
      const { mapping, isEventActive } = await EventMenuMappingService.getMenuForEvent(req.params.eventName, req.params.menuName);
      if (!mapping) return unavailable(res);
      const data: any = isEventActive ? MapperUtil.mapActiveEventResponse(mapping) : MapperUtil.mapFallbackEventResponse(mapping);
      const menu = data?.menu?.displayName || req.params.menuName;
      const vendor = data?.vendor?.displayName;
      const generatedImage = `${PUBLIC_API_ORIGIN}/api/social-previews/event/${encodeURIComponent(req.params.eventName)}/menu/${encodeURIComponent(req.params.menuName)}/v1.jpg`;
      return sendPreview(res, {
        title: vendor ? `${menu} by ${vendor}` : menu,
        description: cleanDescription(data?.menu?.description, `Browse ${menu}${vendor ? ` by ${vendor}` : ''} on Peshkash.`),
        targetUrl: `${PUBLIC_ORIGIN}/event/${encodeURIComponent(req.params.eventName)}/menu/${encodeURIComponent(req.params.menuName)}`,
        type: 'article',
        imageAlt: `${menu}${vendor ? ` collection by ${vendor}` : ' collection'} on Peshkash`,
        fallbackImageUrl: FALLBACK_IMAGE,
        candidates: [
          { url: generatedImage, source: 'generated' },
          { url: firstMenuImage(data?.menu?.lineItems), source: 'hero' },
          { url: data?.vendor?.logoUrl, source: 'hero' },
        ],
      });
    } catch { return unavailable(res); }
  },

  item: async (req: Request, res: Response) => {
    try {
      const { mapping } = await EventMenuMappingService.getMenuForEvent(req.params.eventName, req.params.menuName);
      if (!mapping) return unavailable(res);
      const data: any = MapperUtil.mapActiveEventResponse(mapping, req.params.itemName);
      const item = data?.displayName || data?.name || req.params.itemName;
      const vendor = data?.event?.vendor?.displayName || data?.vendor?.displayName;
      const generatedImage = `${PUBLIC_API_ORIGIN}/api/social-previews/event/${encodeURIComponent(req.params.eventName)}/menu/${encodeURIComponent(req.params.menuName)}/item/${encodeURIComponent(req.params.itemName)}/v1.jpg`;
      return sendPreview(res, {
        title: vendor ? `${item} by ${vendor}` : item,
        description: cleanDescription(data?.description, `Discover ${item}${vendor ? ` by ${vendor}` : ''} on Peshkash.`),
        targetUrl: `${PUBLIC_ORIGIN}/event/${encodeURIComponent(req.params.eventName)}/menu/${encodeURIComponent(req.params.menuName)}/item/${encodeURIComponent(req.params.itemName)}`,
        type: 'article',
        imageAlt: `${item}${vendor ? ` by ${vendor}` : ''} on Peshkash`,
        fallbackImageUrl: FALLBACK_IMAGE,
        candidates: [
          { url: generatedImage, source: 'generated' },
          { url: data?.image, source: 'hero' },
          { url: data?.event?.vendor?.logoUrl || data?.vendor?.logoUrl, source: 'hero' },
        ],
      });
    } catch { return unavailable(res); }
  },
};
