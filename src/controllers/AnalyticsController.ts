import { Request, Response } from 'express';
import { AnalyticsQueryService, buildDateRange, buildDateRangeFromDates } from '../services/AnalyticsQueryService';
import { AnalyticsRecorder } from '../services/AnalyticsRecorder';
import { AnalyticsRepo } from '../repositories/analytics.repository';

type RangeParam = '7d' | '30d' | '90d' | 'all';
const VALID_RANGES: RangeParam[] = ['7d', '30d', '90d', 'all'];

function parseRange(raw: unknown): RangeParam {
  if (typeof raw === 'string' && (VALID_RANGES as string[]).includes(raw)) {
    return raw as RangeParam;
  }
  return '30d'; // safe default
}

function parseVendorId(raw: unknown): number | undefined {
  const n = Number(raw);
  return isNaN(n) || n <= 0 ? undefined : n;
}

export const AnalyticsController = {
  /** GET /api/analytics/summary?from=ISO&to=ISO&vendorId=1 (or ?range=30d for compat) */
  getSummary: async (req: Request, res: Response) => {
    try {
      const vendorId = parseVendorId(req.query.vendorId);
      const eventId  = parseVendorId(req.query.eventId);

      let f;
      const fromStr = req.query.from as string | undefined;
      const toStr   = req.query.to   as string | undefined;
      if (fromStr && toStr) {
        const from = new Date(fromStr);
        const to   = new Date(toStr);
        if (isNaN(from.getTime()) || isNaN(to.getTime())) {
          return res.status(400).json({ error: 'Invalid from/to dates' });
        }
        f = buildDateRangeFromDates(from, to, vendorId, eventId);
      } else {
        f = buildDateRange(parseRange(req.query.range), vendorId, eventId);
      }

      const summary = await AnalyticsQueryService.getSummary(f);
      return res.json(summary);
    } catch (err) {
      console.error('[Analytics] getSummary error:', err);
      return res.status(500).json({ error: 'Analytics unavailable' });
    }
  },

  /** GET /api/analytics/events/:eventId?range=30d */
  getEventAnalytics: async (req: Request, res: Response) => {
    try {
      const eventId = Number(req.params.eventId);
      if (isNaN(eventId)) return res.status(400).json({ error: 'Invalid eventId' });
      const range = parseRange(req.query.range);
      const data = await AnalyticsQueryService.getEventAnalytics(eventId, range);
      return res.json(data);
    } catch (err) {
      console.error('[Analytics] getEventAnalytics error:', err);
      return res.status(500).json({ error: 'Analytics unavailable' });
    }
  },

  /** GET /api/analytics/event-log?vendorId=1&from=ISO&to=ISO&limit=50&offset=0 */
  getEventLog: async (req: Request, res: Response) => {
    try {
      const vendorId = parseVendorId(req.query.vendorId);
      if (!vendorId) return res.status(400).json({ error: 'vendorId required' });

      const fromStr = req.query.from as string | undefined;
      const toStr   = req.query.to   as string | undefined;
      const from = fromStr ? new Date(fromStr) : (() => { const d = new Date(); d.setDate(d.getDate() - 7); return d; })();
      const to   = toStr   ? new Date(toStr)   : new Date();

      const limit  = Math.min(Number(req.query.limit  ?? 50),  200);
      const offset = Math.max(Number(req.query.offset ?? 0),   0);

      const data = await AnalyticsRepo.recentEvents({ from, to, vendorId }, limit, offset);
      return res.json(data);
    } catch (err) {
      console.error('[Analytics] getEventLog error:', err);
      return res.status(500).json({ error: 'Analytics unavailable' });
    }
  },

  /** GET /api/analytics/items/:itemId?range=30d */
  getItemAnalytics: async (req: Request, res: Response) => {
    try {
      const itemId = Number(req.params.itemId);
      if (isNaN(itemId) || itemId <= 0) return res.status(400).json({ error: 'Invalid itemId' });
      const range = parseRange(req.query.range);
      const data = await AnalyticsQueryService.getItemAnalytics(itemId, range);
      return res.json(data);
    } catch (err) {
      console.error('[Analytics] getItemAnalytics error:', err);
      return res.status(500).json({ error: 'Analytics unavailable' });
    }
  },

  /** GET /api/analytics/items?range=30d&vendorId=1 */
  getTopItems: async (req: Request, res: Response) => {
    try {
      const range = parseRange(req.query.range);
      const vendorId = parseVendorId(req.query.vendorId);
      const data = await AnalyticsQueryService.getTopItems(range, vendorId);
      return res.json(data);
    } catch (err) {
      console.error('[Analytics] getTopItems error:', err);
      return res.status(500).json({ error: 'Analytics unavailable' });
    }
  },

  /** GET /api/analytics/events/:eventId/items?range=30d — full per-item breakdown (Excel view) */
  getEventItemsBreakdown: async (req: Request, res: Response) => {
    try {
      const eventId = Number(req.params.eventId);
      if (isNaN(eventId) || eventId <= 0) return res.status(400).json({ error: 'Invalid eventId' });
      const range = parseRange(req.query.range);
      const data = await AnalyticsQueryService.getEventItemsBreakdown(eventId, range);
      return res.json(data);
    } catch (err) {
      console.error('[Analytics] getEventItemsBreakdown error:', err);
      return res.status(500).json({ error: 'Analytics unavailable' });
    }
  },

  /** GET /api/analytics/events-leaderboard?range=30d&vendorId=1 */
  getEventLeaderboard: async (req: Request, res: Response) => {
    try {
      const range = parseRange(req.query.range);
      const vendorId = parseVendorId(req.query.vendorId);
      const data = await AnalyticsQueryService.getEventLeaderboard(range, vendorId);
      return res.json(data);
    } catch (err) {
      console.error('[Analytics] getEventLeaderboard error:', err);
      return res.status(500).json({ error: 'Analytics unavailable' });
    }
  },

  /**
   * GET /api/analytics/export/vendor/:vendorId?from=YYYY-MM-DD&to=YYYY-MM-DD
   *
   * Returns a JSON array of raw, enriched analytics events for the given vendor.
   * The frontend converts this to .xlsx using SheetJS.
   * Default date window: last 90 days.
   */
  exportVendorRaw: async (req: Request, res: Response) => {
    try {
      const vendorId = parseVendorId(req.params.vendorId);
      if (!vendorId) return res.status(400).json({ error: 'Invalid vendorId' });

      // Vendors can only export their own data; admins can export any
      const user = (req as any).user;
      if (user?.role === 'vendor' && user.vendorId !== vendorId) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const to   = req.query.to   ? new Date(req.query.to as string)   : new Date();
      const from = req.query.from ? new Date(req.query.from as string)  : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

      if (isNaN(from.getTime()) || isNaN(to.getTime())) {
        return res.status(400).json({ error: 'Invalid date range' });
      }

      const rows = await AnalyticsRepo.rawExport(vendorId, from, to);
      return res.json(rows);
    } catch (err) {
      console.error('[Analytics] exportVendorRaw error:', err);
      return res.status(500).json({ error: 'Failed to export analytics' });
    }
  },

  /**
   * POST /api/analytics/action
   * Body: { actionType, vendorId?, eventId?, menuId?, itemId?, qrHash? }
   * Called by the frontend useAnalytics composable — always responds 204.
   */
  recordAction: async (req: Request, res: Response) => {
    const { actionType, vendorId, eventId, menuId, itemId, qrHash, pageUrl } = req.body ?? {};
    if (!actionType) return res.status(204).end();

    AnalyticsRecorder.recordAction(
      {
        actionType: String(actionType).slice(0, 50),
        vendorId: vendorId ? Number(vendorId) : undefined,
        eventId: eventId ? Number(eventId) : undefined,
        menuId: menuId ? Number(menuId) : undefined,
        itemId: itemId ? Number(itemId) : undefined,
        qrHash: qrHash ? String(qrHash) : undefined,
        pageUrl: pageUrl ? String(pageUrl).slice(0, 2000) : undefined,
      },
      req
    );

    return res.status(204).end(); // fire-and-forget: always 204
  },
};
