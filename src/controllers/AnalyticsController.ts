import { Request, Response } from 'express';
import { AnalyticsQueryService } from '../services/AnalyticsQueryService';
import { AnalyticsRecorder } from '../services/AnalyticsRecorder';

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
  /** GET /api/analytics/summary?range=30d&vendorId=1 */
  getSummary: async (req: Request, res: Response) => {
    try {
      const range = parseRange(req.query.range);
      const vendorId = parseVendorId(req.query.vendorId);
      const summary = await AnalyticsQueryService.getSummary(range, vendorId);
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
   * POST /api/analytics/action
   * Body: { actionType, vendorId?, eventId?, menuId?, itemId?, qrHash? }
   * Called by the frontend useAnalytics composable — always responds 204.
   */
  recordAction: async (req: Request, res: Response) => {
    const { actionType, vendorId, eventId, menuId, itemId, qrHash } = req.body ?? {};
    if (!actionType) return res.status(204).end();

    AnalyticsRecorder.recordAction(
      {
        actionType: String(actionType).slice(0, 50),
        vendorId: vendorId ? Number(vendorId) : undefined,
        eventId: eventId ? Number(eventId) : undefined,
        menuId: menuId ? Number(menuId) : undefined,
        itemId: itemId ? Number(itemId) : undefined,
        qrHash: qrHash ? String(qrHash) : undefined,
      },
      req
    );

    return res.status(204).end(); // fire-and-forget: always 204
  },
};
