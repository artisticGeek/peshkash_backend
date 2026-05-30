import { Request } from 'express';
import { InsertPayload } from '../repositories/analytics.repository';
import { AnalyticsQueue } from './AnalyticsQueue';

/** Lightweight UA parser — no third-party dependency */
function parseDeviceType(ua: string): 'mobile' | 'desktop' | 'tablet' | 'unknown' {
  if (!ua) return 'unknown';
  const u = ua.toLowerCase();
  if (/tablet|ipad|playbook|silk|(android(?!.*mobile))/.test(u)) return 'tablet';
  if (/mobile|iphone|ipod|android|blackberry|mini|windows\sce|palm/.test(u)) return 'mobile';
  if (/mozilla|chrome|safari|firefox|opera|msie|trident/.test(u)) return 'desktop';
  return 'unknown';
}

export interface ScanPayload {
  qrHash: string;
  qrType?: string;
  qrStatus: 'active' | 'inactive' | 'expired' | 'not_found';
  resolved: boolean;
  resolvedUrl?: string;
  vendorId?: number;
  eventId?: number;
  req: Request;
}

export interface ActionPayload {
  actionType: string;
  vendorId?: number;
  eventId?: number;
  menuId?: number;
  itemId?: number;
  qrHash?: string;
  pageUrl?: string;
}

/**
 * AnalyticsRecorder — Single Responsibility: build the event row and hand it
 * to AnalyticsQueue. Never touches the DB directly.
 *
 * Write path:  Recorder → Queue.enqueue() → Redis LPUSH (~0.1ms)
 * Drain path:  Worker drain loop → bulkCreate every 500ms
 */
export const AnalyticsRecorder = {
  recordScan(payload: ScanPayload): void {
    const ua       = payload.req.headers['user-agent']  ?? '';
    const referrer = payload.req.headers['referer'] ?? payload.req.headers['referrer'] ?? '';

    const row: InsertPayload = {
      eventType:   'qr_scan',
      qrHash:      payload.qrHash,
      qrType:      payload.qrType,
      qrStatus:    payload.qrStatus,
      resolved:    payload.resolved,
      resolvedUrl: payload.resolvedUrl,
      vendorId:    payload.vendorId,
      eventId:     payload.eventId,
      deviceType:  parseDeviceType(ua as string),
      userAgent:   (ua as string).slice(0, 500),
      referrer:    (referrer as string).slice(0, 500),
    };

    AnalyticsQueue.enqueue(row); // ~0.1ms, never throws
  },

  recordAction(payload: ActionPayload, req: Request): void {
    const ua = req.headers['user-agent'] ?? '';

    const row: InsertPayload = {
      eventType:  'action',
      actionType: payload.actionType,
      vendorId:   payload.vendorId,
      eventId:    payload.eventId,
      menuId:     payload.menuId,
      itemId:     payload.itemId,
      qrHash:     payload.qrHash,
      deviceType: parseDeviceType(ua as string),
      userAgent:  (ua as string).slice(0, 500),
      pageUrl:    payload.pageUrl?.slice(0, 2000),
    };

    AnalyticsQueue.enqueue(row); // ~0.1ms, never throws
  },
};
