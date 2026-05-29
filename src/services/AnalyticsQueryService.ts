import { AnalyticsRepo, DateRangeFilter } from '../repositories/analytics.repository';

/** Pre-defined date ranges for the dashboard filter */
export function buildDateRange(range: '7d' | '30d' | '90d' | 'all', vendorId?: number): DateRangeFilter {
  const to = new Date();
  const from = new Date();
  if (range === '7d')  from.setDate(from.getDate() - 7);
  else if (range === '30d') from.setDate(from.getDate() - 30);
  else if (range === '90d') from.setDate(from.getDate() - 90);
  else { from.setFullYear(2020); } // 'all' — epoch start
  return { from, to, vendorId };
}

export interface QrDetail {
  qrHash: string;
  qrType: string;
  targetName: string;
  scans: number;
  actions: number;
  lastActivity: string;
}

export interface DashboardSummary {
  totalScans: number;
  totalActions: number;
  scansPerDay: Array<{ date: string; count: number }>;
  topQrHashes: Array<{ qrHash: string; count: number }>;
  topQrDetails: QrDetail[];
  actionBreakdown: Array<{ actionType: string; count: number }>;
  deviceSplit: Array<{ deviceType: string; count: number }>;
}

/**
 * AnalyticsQueryService — Single Responsibility: compose read-side analytics queries.
 *
 * All methods are async; errors propagate to the controller which handles HTTP 500.
 */
export const AnalyticsQueryService = {

  /** Main dashboard summary — all vendors or scoped to one */
  async getSummary(range: '7d' | '30d' | '90d' | 'all', vendorId?: number): Promise<DashboardSummary> {
    const f = buildDateRange(range, vendorId);

    const [totalScans, totalActions, scansPerDay, topQrHashes, topQrDetails, actionBreakdown, deviceSplit] =
      await Promise.all([
        AnalyticsRepo.totalScans(f),
        AnalyticsRepo.totalActions(f),
        AnalyticsRepo.scansPerDay(f),
        AnalyticsRepo.topQrHashes(f, 10),
        AnalyticsRepo.topQrDetails(f, 10),
        AnalyticsRepo.actionBreakdown(f),
        AnalyticsRepo.deviceSplit(f),
      ]);

    return { totalScans, totalActions, scansPerDay, topQrHashes, topQrDetails, actionBreakdown, deviceSplit };
  },

  /** Event-level analytics (scans + actions for a specific event_id) */
  async getEventAnalytics(eventId: number, range: '7d' | '30d' | '90d' | 'all') {
    const f = buildDateRange(range);
    const fWithEvent = { ...f };

    const [scansPerDay, actionBreakdown, deviceSplit] = await Promise.all([
      AnalyticsRepo.scansPerDay({ ...fWithEvent }),
      AnalyticsRepo.actionBreakdown({ ...fWithEvent }),
      AnalyticsRepo.deviceSplit({ ...fWithEvent }),
    ]);

    // Filter for this specific event
    const [totalScans, totalActions] = await Promise.all([
      AnalyticsRepo.totalScans({ from: f.from, to: f.to }),
      AnalyticsRepo.totalActions({ from: f.from, to: f.to }),
    ]);

    return { totalScans, totalActions, scansPerDay, actionBreakdown, deviceSplit };
  },

  /** Top items by interaction count */
  async getTopItems(range: '7d' | '30d' | '90d' | 'all', vendorId?: number) {
    const f = buildDateRange(range, vendorId);
    return AnalyticsRepo.scansByItem(f);
  },

  /** Per-event scan leaderboard */
  async getEventLeaderboard(range: '7d' | '30d' | '90d' | 'all', vendorId?: number) {
    const f = buildDateRange(range, vendorId);
    return AnalyticsRepo.scansByEvent(f);
  },
};
