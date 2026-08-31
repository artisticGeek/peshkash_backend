import { Request, Response } from 'express';
import { EventMenuMappingService } from '../services/EventMenuMappingService';
import { MapperUtil } from '../utils/MapperUtil';
import { VendorRepo } from '../repositories/vendor.repository';
import { Event } from '../models/event.model';
import { Vendor } from '../models/vendor.model';

const PUBLIC_ORIGIN = process.env.PUBLIC_APP_ORIGIN || 'https://peshkash.app';
const BRAND_IMAGE = `${PUBLIC_ORIGIN}/brand/social/peshkash-whatsapp-dp.png`;

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function cleanDescription(value: unknown, fallback: string) {
  const plain = String(value || fallback).replace(/\s+/g, ' ').trim();
  return plain.slice(0, 220);
}

function previewDocument(input: { title: string; description: string; target: string; type?: string }) {
  const title = escapeHtml(input.title);
  const description = escapeHtml(input.description);
  const target = escapeHtml(input.target);
  const targetJson = JSON.stringify(input.target).replace(/</g, '\\u003c');
  const type = escapeHtml(input.type || 'website');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <meta property="og:site_name" content="Peshkash">
  <meta property="og:type" content="${type}">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:image" content="${BRAND_IMAGE}">
  <meta property="og:image:alt" content="Peshkash — presented by ArtisticGeek Studios">
  <meta property="og:url" content="${target}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:image" content="${BRAND_IMAGE}">
  <link rel="canonical" href="${target}">
  <meta http-equiv="refresh" content="0;url=${target}">
  <style>body{background:#f5efe6;color:#1a1410;font-family:system-ui,sans-serif;display:grid;min-height:100vh;margin:0;place-items:center;text-align:center}a{color:#956a36}</style>
</head>
<body><main><p>Opening <strong>${title}</strong>…</p><a href="${target}">Continue to Peshkash</a></main><script>window.location.replace(${targetJson});</script></body>
</html>`;
}

function sendPreview(res: Response, input: { title: string; description: string; target: string; type?: string }) {
  res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=86400');
  return res.status(200).type('html').send(previewDocument(input));
}

function unavailable(res: Response) {
  return sendPreview(res, {
    title: 'Discover on Peshkash',
    description: 'A digital shop window for products, collections, vendors and events.',
    target: PUBLIC_ORIGIN,
  });
}

export const SharePreviewController = {
  exhibits: async (_req: Request, res: Response) => sendPreview(res, {
    title: 'Peshkash for Exhibitions — Every stall, still discoverable',
    description: 'A short interactive proposal for exhibition organisers: connect every exhibitor, visitor scan and follow-up action with Peshkash.',
    target: `${PUBLIC_ORIGIN}/exhibits`,
    type: 'article',
  }),

  vendor: async (req: Request, res: Response) => {
    try {
      const vendor = await VendorRepo.getByName(req.params.vendorName);
      if (!vendor?.hasContactPage) return unavailable(res);
      return sendPreview(res, {
        title: `${vendor.displayName} — on Peshkash`,
        description: cleanDescription(vendor.description, `Meet ${vendor.displayName}, explore their story and save their details on Peshkash.`),
        target: `${PUBLIC_ORIGIN}/vendor/${encodeURIComponent(vendor.name)}`,
        type: 'profile',
      });
    } catch { return unavailable(res); }
  },

  event: async (req: Request, res: Response) => {
    try {
      const event = await Event.findOne({ where: { name: req.params.eventName }, include: [Vendor] });
      if (!event) return unavailable(res);
      const vendor = event.vendor?.displayName;
      return sendPreview(res, {
        title: vendor ? `${event.displayName} by ${vendor} — Peshkash` : `${event.displayName} — Peshkash`,
        description: cleanDescription(event.eventDescription, `Discover ${event.displayName}, event details, guests and reminders on Peshkash.`),
        target: `${PUBLIC_ORIGIN}/event/${encodeURIComponent(event.name)}`,
        type: 'article',
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
      return sendPreview(res, {
        title: vendor ? `${menu} by ${vendor} — Peshkash` : `${menu} — Peshkash`,
        description: cleanDescription(data?.menu?.description, `Browse ${menu}${vendor ? ` by ${vendor}` : ''} on Peshkash.`),
        target: `${PUBLIC_ORIGIN}/event/${encodeURIComponent(req.params.eventName)}/menu/${encodeURIComponent(req.params.menuName)}`,
        type: 'article',
      });
    } catch { return unavailable(res); }
  },

  item: async (req: Request, res: Response) => {
    try {
      const { mapping, isEventActive } = await EventMenuMappingService.getMenuForEvent(req.params.eventName, req.params.menuName);
      if (!mapping) return unavailable(res);
      const data: any = isEventActive ? MapperUtil.mapActiveEventResponse(mapping, req.params.itemName) : MapperUtil.mapFallbackEventResponse(mapping);
      const item = data?.displayName || data?.name || req.params.itemName;
      const vendor = data?.event?.vendor?.displayName || data?.vendor?.displayName;
      return sendPreview(res, {
        title: vendor ? `${item} by ${vendor} — Peshkash` : `${item} — Peshkash`,
        description: cleanDescription(data?.description, `Discover ${item}${vendor ? ` by ${vendor}` : ''} on Peshkash.`),
        target: `${PUBLIC_ORIGIN}/event/${encodeURIComponent(req.params.eventName)}/menu/${encodeURIComponent(req.params.menuName)}/item/${encodeURIComponent(req.params.itemName)}`,
        type: 'article',
      });
    } catch { return unavailable(res); }
  },
};
