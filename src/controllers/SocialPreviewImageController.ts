import { Request, Response } from 'express';
import sharp from 'sharp';
import { Event } from '../models/event.model';
import { Vendor } from '../models/vendor.model';
import { VendorRepo } from '../repositories/vendor.repository';
import { EventMenuMappingService } from '../services/EventMenuMappingService';
import { MapperUtil } from '../utils/MapperUtil';

function escapeXml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapText(value: string, maxCharacters: number, maxLines: number) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharacters || !current) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === maxLines - 1) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (words.join(' ').length > lines.join(' ').length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[.,;:!?]?$/, '')}…`;
  }
  return lines;
}

function eventDateParts(startTime?: Date) {
  if (!startTime) return { day: '—', month: 'EVENT', full: 'Date to be announced' };
  const date = new Date(startTime);
  return {
    day: new Intl.DateTimeFormat('en-IN', { day: '2-digit', timeZone: 'Asia/Kolkata' }).format(date),
    month: new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'Asia/Kolkata' }).format(date).toUpperCase(),
    full: new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(date),
  };
}

function textLines(lines: string[], x: number, firstY: number, lineHeight: number, className: string) {
  return lines.map((line, index) => `<text x="${x}" y="${firstY + index * lineHeight}" class="${className}">${escapeXml(line)}</text>`).join('');
}

function peshkashBrandBlock() {
  return `
    <svg x="962" y="420" width="66" height="92" viewBox="335 164 181 251" preserveAspectRatio="xMidYMid meet" aria-label="Peshkash logo">
      <path d="M391.5 164H471L516 205L391.5 276.5Z" fill="#E8DBCE"/>
      <path d="M516 205V262.5L470.5 310L391.5 276.5Z" fill="#C5AF9D"/>
      <path d="M391.5 276.5L470.5 310H391.5Z" fill="#8C7667"/>
      <path d="M335 164H392V415L364 389L335 415Z" fill="#BB9057"/>
    </svg>
    <text x="995" y="548" text-anchor="middle" class="brand">PESHKASH</text>
    <text x="995" y="579" text-anchor="middle" class="brandLine">One scan. The right moment.</text>`;
}

export async function renderEntityPreviewImage(input: {
  kind: 'vendor' | 'collection' | 'item';
  title: string;
  description?: string;
  context?: string;
  attribution?: string;
}) {
  const labels = {
    vendor: ['CONTACT', 'VENDOR PROFILE'],
    collection: ['COLLECTION', 'CURATED ON PESHKASH'],
    item: ['ITEM', 'DISCOVER ON PESHKASH'],
  } as const;
  const [panelTitle, panelContext] = labels[input.kind];
  const titleLines = wrapText(input.title, 18, 3);
  const descriptionLines = wrapText(input.description || `Discover ${input.title} on Peshkash.`, 52, 2);
  const titleStart = titleLines.length === 1 ? 270 : titleLines.length === 2 ? 225 : 185;
  const kicker = `${input.kind === 'collection' ? 'COLLECTION' : input.kind.toUpperCase()} · PESHKASH`;
  const context = input.context || (input.kind === 'vendor' ? 'Contact card' : 'Explore on Peshkash');

  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <defs>
      <linearGradient id="paper" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#f7f0e7"/><stop offset="1" stop-color="#e8dac9"/>
      </linearGradient>
      <linearGradient id="ink" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#211812"/><stop offset="1" stop-color="#36271d"/>
      </linearGradient>
      <style>
        .kicker{font:700 19px Arial,sans-serif;letter-spacing:5px;fill:#b88c55}
        .title{font:400 64px Georgia,'Times New Roman',serif;fill:#211812}
        .description{font:400 25px Arial,sans-serif;fill:#5f5043}
        .context{font:600 23px Arial,sans-serif;fill:#211812}
        .attribution{font:400 19px Arial,sans-serif;fill:#806e5e}
        .panelTitle{font:700 34px Arial,sans-serif;letter-spacing:7px;fill:#d1a36a}
        .panelContext{font:600 16px Arial,sans-serif;letter-spacing:4px;fill:#f7f0e7}
        .brand{font:700 18px Arial,sans-serif;letter-spacing:4px;fill:#d1a36a}
        .brandLine{font:400 16px Arial,sans-serif;fill:#d8c7b5}
      </style>
    </defs>
    <rect width="1200" height="630" fill="url(#paper)"/>
    <rect x="790" width="410" height="630" fill="url(#ink)"/>
    <rect x="60" y="60" width="7" height="510" fill="#b88c55"/>
    <circle cx="1075" cy="106" r="112" fill="none" stroke="#7b5d3f" stroke-width="2"/>
    <circle cx="1134" cy="151" r="112" fill="none" stroke="#a17649" stroke-width="2"/>
    <text x="105" y="105" class="kicker">${escapeXml(kicker)}</text>
    ${textLines(titleLines, 105, titleStart, 72, 'title')}
    ${textLines(descriptionLines, 108, 435, 35, 'description')}
    <line x1="105" y1="515" x2="735" y2="515" stroke="#cdbca9" stroke-width="1"/>
    <text x="105" y="554" class="context">${escapeXml(context)}</text>
    <text x="105" y="585" class="attribution">${escapeXml(input.attribution || 'Presented on Peshkash')}</text>
    <text x="995" y="315" text-anchor="middle" class="panelTitle">${escapeXml(panelTitle)}</text>
    <text x="995" y="353" text-anchor="middle" class="panelContext">${escapeXml(panelContext)}</text>
    ${peshkashBrandBlock()}
  </svg>`;

  return sharp(Buffer.from(svg))
    .jpeg({ quality: 88, progressive: true, chromaSubsampling: '4:2:0' })
    .toBuffer();
}

export async function renderEventPreviewImage(event: {
  displayName: string;
  eventDescription?: string;
  startTime?: Date;
  experienceConfig?: Record<string, any>;
  vendor?: { displayName?: string };
}) {
  const config = event.experienceConfig || {};
  const date = eventDateParts(event.startTime);
  const venue = [config.venueName, config.venueAddress].filter(Boolean).join(', ') || 'Venue to be announced';
  const titleLines = wrapText(event.displayName, 23, 3);
  const descriptionLines = wrapText(event.eventDescription || 'An event to discover on Peshkash.', 52, 2);
  const organizer = event.vendor?.displayName ? `Presented by ${event.vendor.displayName}` : 'Presented on Peshkash';
  const titleStart = titleLines.length === 1 ? 270 : titleLines.length === 2 ? 225 : 185;

  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <defs>
      <linearGradient id="paper" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#f7f0e7"/><stop offset="1" stop-color="#e8dac9"/>
      </linearGradient>
      <linearGradient id="ink" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#211812"/><stop offset="1" stop-color="#36271d"/>
      </linearGradient>
      <style>
        .kicker{font:700 19px Arial,sans-serif;letter-spacing:5px;fill:#b88c55}
        .title{font:400 64px Georgia,'Times New Roman',serif;fill:#211812}
        .description{font:400 25px Arial,sans-serif;fill:#5f5043}
        .context{font:600 23px Arial,sans-serif;fill:#211812}
        .organizer{font:400 19px Arial,sans-serif;fill:#806e5e}
        .dateDay{font:400 150px Georgia,'Times New Roman',serif;fill:#f7f0e7}
        .dateMonth{font:700 25px Arial,sans-serif;letter-spacing:8px;fill:#d1a36a}
        .brand{font:700 18px Arial,sans-serif;letter-spacing:4px;fill:#d1a36a}
        .brandLine{font:400 16px Arial,sans-serif;fill:#d8c7b5}
      </style>
    </defs>
    <rect width="1200" height="630" fill="url(#paper)"/>
    <rect x="790" width="410" height="630" fill="url(#ink)"/>
    <rect x="60" y="60" width="7" height="510" fill="#b88c55"/>
    <circle cx="1075" cy="106" r="112" fill="none" stroke="#7b5d3f" stroke-width="2"/>
    <circle cx="1134" cy="151" r="112" fill="none" stroke="#a17649" stroke-width="2"/>
    <text x="105" y="105" class="kicker">EVENT · PESHKASH</text>
    ${textLines(titleLines, 105, titleStart, 72, 'title')}
    ${textLines(descriptionLines, 108, 435, 35, 'description')}
    <line x1="105" y1="515" x2="735" y2="515" stroke="#cdbca9" stroke-width="1"/>
    <text x="105" y="554" class="context">${escapeXml(`${date.full} · ${config.venueName || venue}`)}</text>
    <text x="105" y="585" class="organizer">${escapeXml(organizer)}</text>
    <text x="995" y="329" text-anchor="middle" class="dateDay">${escapeXml(date.day)}</text>
    <text x="995" y="377" text-anchor="middle" class="dateMonth">${escapeXml(date.month)}</text>
    ${peshkashBrandBlock()}
  </svg>`;

  return sharp(Buffer.from(svg))
    .jpeg({ quality: 88, progressive: true, chromaSubsampling: '4:2:0' })
    .toBuffer();
}

export const SocialPreviewImageController = {
  event: async (req: Request, res: Response) => {
    try {
      const event = await Event.findOne({ where: { name: req.params.eventName }, include: [Vendor] });
      const config = (event?.experienceConfig || {}) as Record<string, any>;
      if (!event || !config.enabled || event.status !== 'active') return res.status(404).send('Preview not found');
      const image = await renderEventPreviewImage(event);
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
      res.set('Content-Type', 'image/jpeg');
      return res.status(200).send(image);
    } catch (error) {
      console.error('[SocialPreviewImage] event render failed:', error);
      return res.status(500).send('Preview unavailable');
    }
  },

  vendor: async (req: Request, res: Response) => {
    try {
      const vendor = await VendorRepo.getByName(req.params.vendorName);
      if (!vendor?.hasContactPage) return res.status(404).send('Preview not found');
      const image = await renderEntityPreviewImage({
        kind: 'vendor',
        title: vendor.displayName,
        description: vendor.description,
        context: vendor.address || 'Contact card',
        attribution: `${vendor.displayName} @ Peshkash`,
      });
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
      res.set('Content-Type', 'image/jpeg');
      return res.status(200).send(image);
    } catch (error) {
      console.error('[SocialPreviewImage] vendor render failed:', error);
      return res.status(500).send('Preview unavailable');
    }
  },

  menu: async (req: Request, res: Response) => {
    try {
      const { mapping, isEventActive } = await EventMenuMappingService.getMenuForEvent(req.params.eventName, req.params.menuName);
      if (!mapping) return res.status(404).send('Preview not found');
      const data: any = isEventActive ? MapperUtil.mapActiveEventResponse(mapping) : MapperUtil.mapFallbackEventResponse(mapping);
      const menuName = data?.menu?.displayName || req.params.menuName;
      const vendorName = data?.vendor?.displayName;
      const image = await renderEntityPreviewImage({
        kind: 'collection',
        title: menuName,
        description: data?.menu?.description,
        context: vendorName ? `By ${vendorName}` : 'Collection on Peshkash',
        attribution: vendorName ? `${vendorName} @ Peshkash` : 'Presented on Peshkash',
      });
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
      res.set('Content-Type', 'image/jpeg');
      return res.status(200).send(image);
    } catch (error) {
      console.error('[SocialPreviewImage] collection render failed:', error);
      return res.status(500).send('Preview unavailable');
    }
  },

  item: async (req: Request, res: Response) => {
    try {
      const { mapping } = await EventMenuMappingService.getMenuForEvent(req.params.eventName, req.params.menuName);
      if (!mapping) return res.status(404).send('Preview not found');
      const data: any = MapperUtil.mapActiveEventResponse(mapping, req.params.itemName);
      const itemName = data?.displayName || data?.name || req.params.itemName;
      const vendorName = data?.event?.vendor?.displayName;
      const image = await renderEntityPreviewImage({
        kind: 'item',
        title: itemName,
        description: data?.description,
        context: vendorName ? `By ${vendorName}` : 'Item on Peshkash',
        attribution: vendorName ? `${vendorName} @ Peshkash` : 'Presented on Peshkash',
      });
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
      res.set('Content-Type', 'image/jpeg');
      return res.status(200).send(image);
    } catch (error) {
      console.error('[SocialPreviewImage] item render failed:', error);
      return res.status(500).send('Preview unavailable');
    }
  },
};
