import { AnalyticsRepo, DateRangeFilter } from '../repositories/analytics.repository';

/** Compute granularity — hourly for ranges ≤ 3 days, daily otherwise */
function computeGranularity(from: Date, to: Date): 'hour' | 'day' {
  const diffMs = to.getTime() - from.getTime();
  return diffMs <= 3 * 24 * 3600 * 1000 ? 'hour' : 'day';
}

/** Build a DateRangeFilter from an explicit from/to pair */
export function buildDateRangeFromDates(from: Date, to: Date, vendorId?: number, eventId?: number): DateRangeFilter {
  return { from, to, vendorId, eventId, granularity: computeGranularity(from, to) };
}

/** Pre-defined date ranges for the dashboard filter */
export function buildDateRange(range: '7d' | '30d' | '90d' | 'all', vendorId?: number, eventId?: number): DateRangeFilter {
  const to = new Date();
  const from = new Date();
  if (range === '7d')  from.setDate(from.getDate() - 7);
  else if (range === '30d') from.setDate(from.getDate() - 30);
  else if (range === '90d') from.setDate(from.getDate() - 90);
  else { from.setFullYear(2020); } // 'all' — epoch start
  return { from, to, vendorId, eventId, granularity: computeGranularity(from, to) };
}

export interface QrDetail {
  qrHash: string;
  qrType: string;
  targetName: string;
  scans: number;
  actions: number;
  lastActivity: string;
}

export interface ItemViewed {
  itemId: number;
  itemName: string;
  views: number;
}

export interface ItemDetail {
  itemId: number;
  itemName: string;
  itemType: string;
  vendorName: string;
  eventName: string;
  views: number;
  actions: number;
  lastActivity: string;
}

export interface DashboardSummary {
  totalScans: number;
  totalActions: number;
  /** @deprecated use scansPerPeriod */
  scansPerDay: Array<{ date: string; count: number }>;
  scansPerPeriod: Array<{ period: string; count: number }>;
  topQrHashes: Array<{ qrHash: string; count: number }>;
  topQrDetails: QrDetail[];
  actionBreakdown: Array<{ actionType: string; count: number }>;
  actionsPerPeriodByType: Array<{ period: string; actionType: string; count: number }>;
  deviceSplit: Array<{ deviceType: string; count: number }>;
  lastActivity: string | null;
  topItemsViewed: ItemViewed[];
  topItemsDetailed: ItemDetail[];
  granularity: 'hour' | 'day';
  rangeFrom: string;
  rangeTo: string;
}

export interface ItemAnalytics {
  totalViews: number;
  totalActions: number;
  viewsPerDay: Array<{ date: string; count: number }>;
  viewsPerPeriod: Array<{ period: string; count: number }>;
  actionsPerPeriodByType: Array<{ period: string; actionType: string; count: number }>;
  granularity: 'hour' | 'day';
  actionBreakdown: Array<{ actionType: string; count: number }>;
  lastActivity: string | null;
  linkedQrHashes: string[];
}

/**
 * AnalyticsQueryService — Single Responsibility: compose read-side analytics queries.
 *
 * All methods are async; errors propagate to the controller which handles HTTP 500.
 */
export const AnalyticsQueryService = {

  /** Main dashboard summary — all vendors, scoped to a vendor, or scoped to an event */
  async getSummary(f: DateRangeFilter): Promise<DashboardSummary> {
    const [totalScans, totalActions, scansPerPeriod, topQrHashes, topQrDetails, actionBreakdown, actionsPerPeriodByType, deviceSplit, lastActivity, topItemsViewed, topItemsDetailed] =
      await Promise.all([
        AnalyticsRepo.totalScans(f),
        AnalyticsRepo.totalActions(f),
        AnalyticsRepo.scansPerPeriod(f),
        AnalyticsRepo.topQrHashes(f, 10),
        AnalyticsRepo.topQrDetails(f, 10),
        AnalyticsRepo.actionBreakdown(f),
        AnalyticsRepo.actionsPerPeriodByType(f),
        AnalyticsRepo.deviceSplit(f),
        AnalyticsRepo.lastActivity(f),
        f.eventId ? AnalyticsRepo.topItemsViewed(f, 10) : Promise.resolve([]),
        AnalyticsRepo.topItemsDetailed(f, 15),
      ]);

    return {
      totalScans, totalActions,
      scansPerDay: [],      // deprecated field — kept for schema compat
      scansPerPeriod,
      topQrHashes, topQrDetails, actionBreakdown,
      actionsPerPeriodByType,
      deviceSplit, lastActivity, topItemsViewed, topItemsDetailed,
      granularity: f.granularity ?? 'day',
      rangeFrom: f.from.toISOString(),
      rangeTo:   f.to.toISOString(),
    };
  },

  /** Event-level analytics (scans + actions for a specific event_id) */
  async getEventAnalytics(eventId: number, range: '7d' | '30d' | '90d' | 'all') {
    const f = buildDateRange(range, undefined, eventId);
    const [totalScans, totalActions, scansPerDay, actionBreakdown, deviceSplit] = await Promise.all([
      AnalyticsRepo.totalScans(f),
      AnalyticsRepo.totalActions(f),
      AnalyticsRepo.scansPerDay(f),
      AnalyticsRepo.actionBreakdown(f),
      AnalyticsRepo.deviceSplit(f),
    ]);
    return { totalScans, totalActions, scansPerDay, actionBreakdown, deviceSplit };
  },

  /** Top items by interaction count */
  async getTopItems(range: '7d' | '30d' | '90d' | 'all', vendorId?: number) {
    const f = buildDateRange(range, vendorId);
    return AnalyticsRepo.topItemsDetailed(f, 100);
  },

  /** Full analytics for a single item/product */
  async getItemAnalytics(itemId: number, range: '7d' | '30d' | '90d' | 'all'): Promise<ItemAnalytics> {
    return this.getItemAnalyticsWithFilter(itemId, buildDateRange(range));
  },

  /** Full analytics for a single item/product using an explicit DateRangeFilter */
  async getItemAnalyticsWithFilter(itemId: number, f: DateRangeFilter): Promise<ItemAnalytics> {
    const [totalViews, totalActions, viewsPerDay, viewsPerPeriod, actionsPerPeriodByType, actionBreakdown, lastActivity, linkedQrHashes] =
      await Promise.all([
        AnalyticsRepo.itemViews(itemId, f),
        AnalyticsRepo.itemActions(itemId, f),
        AnalyticsRepo.itemViewsPerDay(itemId, f),
        AnalyticsRepo.itemViewsPerPeriod(itemId, f),
        AnalyticsRepo.itemActionsPerPeriodByType(itemId, f),
        AnalyticsRepo.itemActionBreakdown(itemId, f),
        AnalyticsRepo.itemLastActivity(itemId, f),
        AnalyticsRepo.itemLinkedQrHashes(itemId),
      ]);
    return { totalViews, totalActions, viewsPerDay, viewsPerPeriod, actionsPerPeriodByType, granularity: f.granularity ?? 'day', actionBreakdown, lastActivity, linkedQrHashes };
  },

  /** Per-item action breakdown for one event — powers the "Excel table" in the drill-down drawer */
  async getEventItemsBreakdown(eventId: number, range: '7d' | '30d' | '90d' | 'all') {
    const f = buildDateRange(range);
    return AnalyticsRepo.itemsBreakdownByEvent(eventId, f);
  },

  /** ALL items for an event's menus, analytics overlaid (0s for items with no events yet) */
  async getAllItemsForEvent(eventId: number, range: '7d' | '30d' | '90d' | 'all') {
    const f = buildDateRange(range);
    return AnalyticsRepo.allItemsForEvent(eventId, f);
  },

  /** Per-event scan leaderboard */
  async getEventLeaderboard(range: '7d' | '30d' | '90d' | 'all', vendorId?: number) {
    const f = buildDateRange(range, vendorId);
    return AnalyticsRepo.scansByEvent(f);
  },

  /** Paginated raw event log — powers the "Activity Log" drill-down (EventLog.vue) */
  async getEventLog(
    filter: { from: Date; to: Date; vendorId?: number; eventId?: number; itemId?: number },
    limit: number,
    offset: number
  ) {
    return AnalyticsRepo.eventLog(filter, limit, offset);
  },
};
