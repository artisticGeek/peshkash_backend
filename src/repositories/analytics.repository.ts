import { Op, fn, col, literal, QueryTypes } from 'sequelize';
import { AnalyticsEvent } from '../models/analyticsEvent.model';
import { sequelize } from '../config/sequelize';

export interface InsertPayload {
  eventType: string;
  actionType?: string;
  qrHash?: string;
  qrType?: string;
  qrStatus?: string;
  resolved?: boolean;
  resolvedUrl?: string;
  vendorId?: number;
  eventId?: number;
  menuId?: number;
  itemId?: number;
  deviceType?: string;
  userAgent?: string;
  referrer?: string;
}

export interface DateRangeFilter {
  from: Date;
  to: Date;
  vendorId?: number;
}

export const AnalyticsRepo = {
  /** Append one event row — fast INSERT, called from fire-and-forget paths */
  insert: (payload: InsertPayload) => AnalyticsEvent.create(payload as any),

  /** Total scans in a date range (optionally scoped to vendor) */
  totalScans: async (f: DateRangeFilter): Promise<number> => {
    return AnalyticsEvent.count({
      where: {
        eventType: 'qr_scan',
        createdAt: { [Op.between]: [f.from, f.to] },
        ...(f.vendorId ? { vendorId: f.vendorId } : {}),
      },
    });
  },

  /** Total unique actions in a date range */
  totalActions: async (f: DateRangeFilter): Promise<number> => {
    return AnalyticsEvent.count({
      where: {
        eventType: 'action',
        createdAt: { [Op.between]: [f.from, f.to] },
        ...(f.vendorId ? { vendorId: f.vendorId } : {}),
      },
    });
  },

  /** Scans per day — returns rows [{date, count}] */
  scansPerDay: async (f: DateRangeFilter): Promise<Array<{ date: string; count: number }>> => {
    const rows = await sequelize.query<{ date: string; count: string }>(
      `SELECT DATE(created_at) AS date, COUNT(*) AS count
       FROM analytics_event
       WHERE event_type = 'qr_scan'
         AND created_at BETWEEN :from AND :to
         ${f.vendorId ? 'AND vendor_id = :vendorId' : ''}
       GROUP BY DATE(created_at)
       ORDER BY DATE(created_at) ASC`,
      {
        replacements: { from: f.from, to: f.to, vendorId: f.vendorId },
        type: QueryTypes.SELECT,
      }
    );
    return rows.map(r => ({ date: r.date, count: Number(r.count) }));
  },

  /** Top QR hashes by scan count */
  topQrHashes: async (f: DateRangeFilter, limit = 10): Promise<Array<{ qrHash: string; count: number }>> => {
    const rows = await sequelize.query<{ qr_hash: string; count: string }>(
      `SELECT qr_hash, COUNT(*) AS count
       FROM analytics_event
       WHERE event_type = 'qr_scan'
         AND qr_hash IS NOT NULL
         AND created_at BETWEEN :from AND :to
         ${f.vendorId ? 'AND vendor_id = :vendorId' : ''}
       GROUP BY qr_hash
       ORDER BY count DESC
       LIMIT :limit`,
      {
        replacements: { from: f.from, to: f.to, vendorId: f.vendorId, limit },
        type: QueryTypes.SELECT,
      }
    );
    return rows.map(r => ({ qrHash: r.qr_hash, count: Number(r.count) }));
  },

  /** Action breakdown by action_type */
  actionBreakdown: async (f: DateRangeFilter): Promise<Array<{ actionType: string; count: number }>> => {
    const rows = await sequelize.query<{ action_type: string; count: string }>(
      `SELECT action_type, COUNT(*) AS count
       FROM analytics_event
       WHERE event_type = 'action'
         AND action_type IS NOT NULL
         AND created_at BETWEEN :from AND :to
         ${f.vendorId ? 'AND vendor_id = :vendorId' : ''}
       GROUP BY action_type
       ORDER BY count DESC`,
      {
        replacements: { from: f.from, to: f.to, vendorId: f.vendorId },
        type: QueryTypes.SELECT,
      }
    );
    return rows.map(r => ({ actionType: r.action_type, count: Number(r.count) }));
  },

  /** Device type split for scans */
  deviceSplit: async (f: DateRangeFilter): Promise<Array<{ deviceType: string; count: number }>> => {
    const rows = await sequelize.query<{ device_type: string; count: string }>(
      `SELECT COALESCE(device_type, 'unknown') AS device_type, COUNT(*) AS count
       FROM analytics_event
       WHERE event_type = 'qr_scan'
         AND created_at BETWEEN :from AND :to
         ${f.vendorId ? 'AND vendor_id = :vendorId' : ''}
       GROUP BY COALESCE(device_type, 'unknown')
       ORDER BY count DESC`,
      {
        replacements: { from: f.from, to: f.to, vendorId: f.vendorId },
        type: QueryTypes.SELECT,
      }
    );
    return rows.map(r => ({ deviceType: r.device_type, count: Number(r.count) }));
  },

  /** Scans per event */
  scansByEvent: async (f: DateRangeFilter): Promise<Array<{ eventId: number; count: number }>> => {
    const rows = await sequelize.query<{ event_id: string; count: string }>(
      `SELECT event_id, COUNT(*) AS count
       FROM analytics_event
       WHERE event_type = 'qr_scan'
         AND event_id IS NOT NULL
         AND created_at BETWEEN :from AND :to
         ${f.vendorId ? 'AND vendor_id = :vendorId' : ''}
       GROUP BY event_id
       ORDER BY count DESC`,
      {
        replacements: { from: f.from, to: f.to, vendorId: f.vendorId },
        type: QueryTypes.SELECT,
      }
    );
    return rows.map(r => ({ eventId: Number(r.event_id), count: Number(r.count) }));
  },

  /** Scans per item (for menu engagement analytics) */
  scansByItem: async (f: DateRangeFilter): Promise<Array<{ itemId: number; count: number }>> => {
    const rows = await sequelize.query<{ item_id: string; count: string }>(
      `SELECT item_id, COUNT(*) AS count
       FROM analytics_event
       WHERE item_id IS NOT NULL
         AND created_at BETWEEN :from AND :to
         ${f.vendorId ? 'AND vendor_id = :vendorId' : ''}
       GROUP BY item_id
       ORDER BY count DESC
       LIMIT 20`,
      {
        replacements: { from: f.from, to: f.to, vendorId: f.vendorId },
        type: QueryTypes.SELECT,
      }
    );
    return rows.map(r => ({ itemId: Number(r.item_id), count: Number(r.count) }));
  },
};
