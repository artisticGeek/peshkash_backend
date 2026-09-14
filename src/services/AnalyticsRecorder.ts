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

const WINDOWS_NAMES: Record<string, string> = {
  '10.0': '10/11', '6.3': '8.1', '6.2': '8', '6.1': '7', '6.0': 'Vista', '5.1': 'XP',
};

/** Lightweight OS parser — same style as parseDeviceType, no third-party dependency.
 *  Includes version where the UA string still carries one — desktop Chrome has frozen
 *  its own reported OS version (User-Agent Reduction), so that case falls back to the
 *  bare name; iOS/Android/macOS/Firefox/Safari still report real versions. */
function parseOs(ua: string): string | undefined {
  if (!ua) return undefined;
  let m: RegExpExecArray | null;
  // iOS before macOS — an iPhone/iPad UA also contains "like Mac OS X" as a substring.
  if ((m = /CPU (?:iPhone )?OS ([\d_]+)/.exec(ua))) return `iOS ${m[1].replace(/_/g, '.')}`;
  if ((m = /Windows NT ([\d.]+)/.exec(ua))) return `Windows ${WINDOWS_NAMES[m[1]] ?? m[1]}`;
  if ((m = /Android ([\d.]+)/.exec(ua))) return `Android ${m[1]}`;
  if ((m = /Mac OS X ([\d_]+)/.exec(ua))) return `macOS ${m[1].replace(/_/g, '.')}`;
  if (/windows/i.test(ua)) return 'Windows';
  if (/iphone|ipad|ipod/i.test(ua)) return 'iOS';
  if (/android/i.test(ua)) return 'Android';
  if (/mac os x|macintosh/i.test(ua)) return 'macOS';
  if (/linux/i.test(ua)) return 'Linux';
  return undefined;
}

/** Browser name + major version. Order matters: Edge/Samsung/Opera/iOS-Chrome/iOS-Firefox
 *  UAs all also contain "Chrome/" or "Safari/" tokens, so the more specific browser must be
 *  checked first or every Chromium-based browser would misreport as plain Chrome. */
function parseBrowser(ua: string): string | undefined {
  if (!ua) return undefined;
  let m: RegExpExecArray | null;
  if ((m = /Edg\/([\d.]+)/.exec(ua)))            return `Edge ${m[1].split('.')[0]}`;
  if ((m = /SamsungBrowser\/([\d.]+)/.exec(ua)))  return `Samsung Internet ${m[1].split('.')[0]}`;
  if ((m = /OPR\/([\d.]+)/.exec(ua)))            return `Opera ${m[1].split('.')[0]}`;
  if ((m = /CriOS\/([\d.]+)/.exec(ua)))          return `Chrome ${m[1].split('.')[0]}`; // Chrome on iOS
  if ((m = /FxiOS\/([\d.]+)/.exec(ua)))          return `Firefox ${m[1].split('.')[0]}`; // Firefox on iOS
  if ((m = /Firefox\/([\d.]+)/.exec(ua)))         return `Firefox ${m[1].split('.')[0]}`;
  if ((m = /Chrome\/([\d.]+)/.exec(ua)))          return `Chrome ${m[1].split('.')[0]}`;
  if ((m = /Version\/([\d.]+).*Safari/.exec(ua))) return `Safari ${m[1].split('.')[0]}`;
  if (/Safari/.test(ua)) return 'Safari';
  if (/MSIE ([\d.]+)/.test(ua) || /Trident/.test(ua)) return 'Internet Explorer';
  return undefined;
}

/** Coarse device label from the same UA — not a specific model (iOS/most Android UAs don't
 *  expose that without extra client-side work), just a friendlier name than deviceType alone. */
function parseDeviceName(ua: string, deviceType: string): string | undefined {
  if (!ua) return undefined;
  if (/iPad/.test(ua))      return 'iPad';
  if (/iPhone/.test(ua))    return 'iPhone';
  if (/iPod/.test(ua))      return 'iPod';
  if (/Android/.test(ua))   return deviceType === 'tablet' ? 'Android Tablet' : 'Android Phone';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua))   return 'Windows PC';
  if (/Linux/.test(ua))     return 'Linux PC';
  return undefined;
}

export interface ScanPayload {
  qrHash: string;
  qrType?: string;
  qrStatus: 'active' | 'inactive' | 'expired' | 'not_found';
  resolved: boolean;
  resolvedUrl?: string;
  vendorId?: number;
  eventId?: number;
  deviceId?: string;
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
  phone?: string;
  deviceId?: string;
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
    const ua         = (payload.req.headers['user-agent'] ?? '') as string;
    const referrer    = (payload.req.headers['referer'] ?? payload.req.headers['referrer'] ?? '') as string;
    const deviceType = parseDeviceType(ua);

    const row: InsertPayload = {
      eventType:   'qr_scan',
      qrHash:      payload.qrHash,
      qrType:      payload.qrType,
      qrStatus:    payload.qrStatus,
      resolved:    payload.resolved,
      resolvedUrl: payload.resolvedUrl,
      vendorId:    payload.vendorId,
      eventId:     payload.eventId,
      deviceType,
      os:          parseOs(ua),
      browser:     parseBrowser(ua),
      deviceName:  parseDeviceName(ua, deviceType),
      userAgent:   ua.slice(0, 500),
      referrer:    referrer.slice(0, 500),
      deviceId:    payload.deviceId,
    };

    AnalyticsQueue.enqueue(row); // ~0.1ms, never throws
  },

  recordAction(payload: ActionPayload, req: Request): void {
    const ua         = (req.headers['user-agent'] ?? '') as string;
    const deviceType = parseDeviceType(ua);

    const row: InsertPayload = {
      eventType:  'action',
      actionType: payload.actionType,
      vendorId:   payload.vendorId,
      eventId:    payload.eventId,
      menuId:     payload.menuId,
      itemId:     payload.itemId,
      qrHash:     payload.qrHash,
      deviceType,
      os:         parseOs(ua),
      browser:    parseBrowser(ua),
      deviceName: parseDeviceName(ua, deviceType),
      userAgent:  ua.slice(0, 500),
      pageUrl:    payload.pageUrl?.slice(0, 2000),
      phone:      payload.phone?.slice(0, 20),
      deviceId:   payload.deviceId,
    };

    AnalyticsQueue.enqueue(row); // ~0.1ms, never throws
  },
};
