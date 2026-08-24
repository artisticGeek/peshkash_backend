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
  pageUrl?: string;
}

export interface DateRangeFilter {
  from: Date;
  to: Date;
  vendorId?: number;
  eventId?: number;
}

export const AnalyticsRepo = {
  /** Append one event row — fast INSERT, called from fire-and-forget paths */
  insert: (payload: InsertPayload) => AnalyticsEvent.create(payload as any),

  /** Total scans in a date range (optionally scoped to vendor or event) */
  totalScans: async (f: DateRangeFilter): Promise<number> => {
    const rows = await sequelize.query<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM analytics_event ae
       ${f.vendorId ? 'LEFT JOIN qr_link_mapping q ON q.qr_hash = ae.qr_hash' : ''}
       WHERE ae.event_type = 'qr_scan'
         AND ae.created_at BETWEEN :from AND :to
         ${f.vendorId ? 'AND (ae.vendor_id = :vendorId OR q.vendor_id = :vendorId)' : ''}
         ${f.eventId  ? 'AND ae.event_id = :eventId' : ''}`,
      { replacements: { from: f.from, to: f.to, vendorId: f.vendorId, eventId: f.eventId }, type: QueryTypes.SELECT }
    );
    return Number(rows[0]?.count ?? 0);
  },

  /** Total unique actions in a date range */
  totalActions: async (f: DateRangeFilter): Promise<number> => {
    return AnalyticsEvent.count({
      where: {
        eventType: 'action',
        createdAt: { [Op.between]: [f.from, f.to] },
        ...(f.vendorId ? { vendorId: f.vendorId } : {}),
        ...(f.eventId  ? { eventId:  f.eventId  } : {}),
      },
    });
  },

  /** Scans per day — returns rows [{date, count}] */
  scansPerDay: async (f: DateRangeFilter): Promise<Array<{ date: string; count: number }>> => {
    const rows = await sequelize.query<{ date: string; count: string }>(
      `SELECT DATE(ae.created_at) AS date, COUNT(*) AS count
       FROM analytics_event ae
       ${f.vendorId ? 'LEFT JOIN qr_link_mapping q ON q.qr_hash = ae.qr_hash' : ''}
       WHERE ae.event_type = 'qr_scan'
         AND ae.created_at BETWEEN :from AND :to
         ${f.vendorId ? 'AND (ae.vendor_id = :vendorId OR q.vendor_id = :vendorId)' : ''}
         ${f.eventId  ? 'AND ae.event_id  = :eventId'  : ''}
       GROUP BY DATE(ae.created_at)
       ORDER BY DATE(ae.created_at) ASC`,
      {
        replacements: { from: f.from, to: f.to, vendorId: f.vendorId, eventId: f.eventId },
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
         ${f.eventId  ? 'AND event_id  = :eventId'  : ''}
       GROUP BY qr_hash
       ORDER BY count DESC
       LIMIT :limit`,
      {
        replacements: { from: f.from, to: f.to, vendorId: f.vendorId, eventId: f.eventId, limit },
        type: QueryTypes.SELECT,
      }
    );
    return rows.map(r => ({ qrHash: r.qr_hash, count: Number(r.count) }));
  },

  /** Enriched top QR table: scans, actions (via vendor/event match), type, target name, last activity */
  topQrDetails: async (f: DateRangeFilter, limit = 10): Promise<Array<{
    qrHash: string;
    qrType: string;
    targetName: string;
    scans: number;
    actions: number;
    lastActivity: string;
  }>> => {
    const rows = await sequelize.query<{
      qr_hash: string; qr_type: string; target_name: string;
      scans: string; actions: string; last_activity: string;
    }>(
      `WITH top_qr AS (
         SELECT
           ae.qr_hash,
           COALESCE(q.type, 'static')                                   AS qr_type,
           q.vendor_id,
           q.event_id,
           COALESCE(e.display_name, v.display_name, ae.qr_hash)         AS target_name,
           COUNT(*)                                                      AS scans,
           MAX(ae.created_at)                                            AS last_activity
         FROM analytics_event ae
         LEFT JOIN qr_link_mapping q ON q.qr_hash = ae.qr_hash
         LEFT JOIN event           e ON e.id = q.event_id
         LEFT JOIN vendor          v ON v.id = q.vendor_id
         WHERE ae.event_type = 'qr_scan'
           AND ae.qr_hash IS NOT NULL
           AND ae.created_at BETWEEN :from AND :to
           ${f.vendorId ? 'AND (ae.vendor_id = :vendorId OR q.vendor_id = :vendorId)' : ''}
           ${f.eventId  ? 'AND (ae.event_id  = :eventId  OR q.event_id  = :eventId )'  : ''}
         GROUP BY ae.qr_hash, q.type, q.vendor_id, q.event_id, e.display_name, v.display_name
         ORDER BY scans DESC
         LIMIT :limit
       ),
       action_counts AS (
         SELECT qm.qr_hash, COUNT(DISTINCT ae.id) AS actions
         FROM analytics_event ae
         JOIN qr_link_mapping qm ON (
           (qm.vendor_id IS NOT NULL AND ae.vendor_id = qm.vendor_id)
           OR (qm.event_id IS NOT NULL AND ae.event_id = qm.event_id)
         )
         WHERE ae.event_type = 'action'
           AND ae.created_at BETWEEN :from AND :to
           AND qm.qr_hash IN (SELECT qr_hash FROM top_qr)
         GROUP BY qm.qr_hash
       )
       SELECT
         t.qr_hash, t.qr_type, t.target_name, t.scans,
         COALESCE(a.actions, 0) AS actions,
         t.last_activity
       FROM top_qr t
       LEFT JOIN action_counts a ON a.qr_hash = t.qr_hash`,
      {
        replacements: { from: f.from, to: f.to, vendorId: f.vendorId, eventId: f.eventId, limit },
        type: QueryTypes.SELECT,
      }
    );
    return rows.map(r => ({
      qrHash: r.qr_hash,
      qrType: r.qr_type,
      targetName: r.target_name,
      scans: Number(r.scans),
      actions: Number(r.actions),
      lastActivity: r.last_activity,
    }));
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
         ${f.eventId  ? 'AND event_id  = :eventId'  : ''}
       GROUP BY action_type
       ORDER BY count DESC`,
      {
        replacements: { from: f.from, to: f.to, vendorId: f.vendorId, eventId: f.eventId },
        type: QueryTypes.SELECT,
      }
    );
    return rows.map(r => ({ actionType: r.action_type, count: Number(r.count) }));
  },

  /** Device type split for scans */
  deviceSplit: async (f: DateRangeFilter): Promise<Array<{ deviceType: string; count: number }>> => {
    const rows = await sequelize.query<{ device_type: string; count: string }>(
      `SELECT COALESCE(ae.device_type, 'unknown') AS device_type, COUNT(*) AS count
       FROM analytics_event ae
       ${f.vendorId ? 'LEFT JOIN qr_link_mapping q ON q.qr_hash = ae.qr_hash' : ''}
       WHERE ae.event_type = 'qr_scan'
         AND ae.created_at BETWEEN :from AND :to
         ${f.vendorId ? 'AND (ae.vendor_id = :vendorId OR q.vendor_id = :vendorId)' : ''}
         ${f.eventId  ? 'AND ae.event_id  = :eventId'  : ''}
       GROUP BY COALESCE(ae.device_type, 'unknown')
       ORDER BY count DESC`,
      {
        replacements: { from: f.from, to: f.to, vendorId: f.vendorId, eventId: f.eventId },
        type: QueryTypes.SELECT,
      }
    );
    return rows.map(r => ({ deviceType: r.device_type, count: Number(r.count) }));
  },

  /** Timestamp of the most recent analytics event in the scope */
  lastActivity: async (f: DateRangeFilter): Promise<string | null> => {
    const rows = await sequelize.query<{ last_activity: string | null }>(
      `SELECT MAX(ae.created_at) AS last_activity
       FROM analytics_event ae
       ${f.vendorId ? 'LEFT JOIN qr_link_mapping q ON q.qr_hash = ae.qr_hash' : ''}
       WHERE ae.created_at BETWEEN :from AND :to
         ${f.vendorId ? 'AND (ae.vendor_id = :vendorId OR q.vendor_id = :vendorId)' : ''}
         ${f.eventId  ? 'AND ae.event_id  = :eventId'  : ''}`,
      {
        replacements: { from: f.from, to: f.to, vendorId: f.vendorId, eventId: f.eventId },
        type: QueryTypes.SELECT,
      }
    );
    return rows[0]?.last_activity ?? null;
  },

  /** Top viewed line items (item_expand / item_detail_view actions with item_id) */
  topItemsViewed: async (f: DateRangeFilter, limit = 10): Promise<Array<{ itemId: number; itemName: string; views: number }>> => {
    const rows = await sequelize.query<{ item_id: string; item_name: string; views: string }>(
      `SELECT ae.item_id, COALESCE(li.display_name, li.name, ae.item_id::text) AS item_name, COUNT(*) AS views
       FROM analytics_event ae
       LEFT JOIN line_item li ON li.id = ae.item_id
       WHERE ae.event_type = 'action'
         AND ae.action_type IN ('item_expand', 'item_detail_view')
         AND ae.item_id IS NOT NULL
         AND ae.created_at BETWEEN :from AND :to
         ${f.vendorId ? 'AND ae.vendor_id = :vendorId' : ''}
         ${f.eventId  ? 'AND ae.event_id  = :eventId'  : ''}
       GROUP BY ae.item_id, li.display_name, li.name
       ORDER BY views DESC
       LIMIT :limit`,
      {
        replacements: { from: f.from, to: f.to, vendorId: f.vendorId, eventId: f.eventId, limit },
        type: QueryTypes.SELECT,
      }
    );
    return rows.map(r => ({ itemId: Number(r.item_id), itemName: r.item_name, views: Number(r.views) }));
  },

  /** Enriched top-items table: views, actions, vendor/event names, last activity */
  topItemsDetailed: async (f: DateRangeFilter, limit = 15): Promise<Array<{
    itemId: number; itemName: string; itemType: string;
    vendorName: string; eventName: string;
    views: number; actions: number; lastActivity: string;
  }>> => {
    const rows = await sequelize.query<{
      item_id: string; item_name: string; item_type: string;
      vendor_name: string; event_name: string;
      views: string; actions: string; last_activity: string;
    }>(
      `SELECT
         ae.item_id,
         COALESCE(li.display_name, li.name) AS item_name,
         COALESCE(li.type, 'item')           AS item_type,
         COALESCE(v.display_name, '')         AS vendor_name,
         COALESCE(e.display_name, '')         AS event_name,
         COUNT(*) FILTER (WHERE ae.action_type IN ('item_expand','item_detail_view'))                                      AS views,
         COUNT(*) FILTER (WHERE ae.action_type NOT IN ('item_expand','item_detail_view','menu_view','vendor_contact_view')) AS actions,
         MAX(ae.created_at)                   AS last_activity
       FROM analytics_event ae
       LEFT JOIN line_item li ON li.id = ae.item_id
       LEFT JOIN vendor    v  ON v.id  = ae.vendor_id
       LEFT JOIN event     e  ON e.id  = ae.event_id
       WHERE ae.item_id IS NOT NULL
         AND ae.event_type = 'action'
         AND ae.created_at BETWEEN :from AND :to
         ${f.vendorId ? 'AND ae.vendor_id = :vendorId' : ''}
         ${f.eventId  ? 'AND ae.event_id  = :eventId'  : ''}
       GROUP BY ae.item_id, li.display_name, li.name, li.type, v.display_name, e.display_name
       ORDER BY views DESC
       LIMIT :limit`,
      {
        replacements: { from: f.from, to: f.to, vendorId: f.vendorId, eventId: f.eventId, limit },
        type: QueryTypes.SELECT,
      }
    );
    return rows.map(r => ({
      itemId: Number(r.item_id),
      itemName: r.item_name,
      itemType: r.item_type,
      vendorName: r.vendor_name,
      eventName: r.event_name,
      views: Number(r.views),
      actions: Number(r.actions),
      lastActivity: r.last_activity,
    }));
  },

  // ── Single-item analytics ─────────────────────────────────────────────────

  /** Total views (item_expand + item_detail_view) for one item */
  itemViews: async (itemId: number, f: DateRangeFilter): Promise<number> => {
    const rows = await sequelize.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM analytics_event
       WHERE item_id = :itemId AND event_type = 'action'
         AND action_type IN ('item_expand','item_detail_view')
         AND created_at BETWEEN :from AND :to`,
      { replacements: { itemId, from: f.from, to: f.to }, type: QueryTypes.SELECT }
    );
    return Number(rows[0]?.count ?? 0);
  },

  /** Customer actions (non-view) for one item */
  itemActions: async (itemId: number, f: DateRangeFilter): Promise<number> => {
    const rows = await sequelize.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM analytics_event
       WHERE item_id = :itemId AND event_type = 'action'
         AND action_type NOT IN ('item_expand','item_detail_view','menu_view','vendor_contact_view')
         AND created_at BETWEEN :from AND :to`,
      { replacements: { itemId, from: f.from, to: f.to }, type: QueryTypes.SELECT }
    );
    return Number(rows[0]?.count ?? 0);
  },

  /** Views per day for one item */
  itemViewsPerDay: async (itemId: number, f: DateRangeFilter): Promise<Array<{ date: string; count: number }>> => {
    const rows = await sequelize.query<{ date: string; count: string }>(
      `SELECT DATE(created_at) AS date, COUNT(*) AS count
       FROM analytics_event
       WHERE item_id = :itemId AND event_type = 'action'
         AND action_type IN ('item_expand','item_detail_view')
         AND created_at BETWEEN :from AND :to
       GROUP BY DATE(created_at) ORDER BY date ASC`,
      { replacements: { itemId, from: f.from, to: f.to }, type: QueryTypes.SELECT }
    );
    return rows.map(r => ({ date: r.date, count: Number(r.count) }));
  },

  /** Action breakdown for one item */
  itemActionBreakdown: async (itemId: number, f: DateRangeFilter): Promise<Array<{ actionType: string; count: number }>> => {
    const rows = await sequelize.query<{ action_type: string; count: string }>(
      `SELECT action_type, COUNT(*) AS count
       FROM analytics_event
       WHERE item_id = :itemId AND event_type = 'action'
         AND action_type NOT IN ('item_expand','item_detail_view','menu_view','vendor_contact_view')
         AND created_at BETWEEN :from AND :to
       GROUP BY action_type ORDER BY count DESC`,
      { replacements: { itemId, from: f.from, to: f.to }, type: QueryTypes.SELECT }
    );
    return rows.map(r => ({ actionType: r.action_type, count: Number(r.count) }));
  },

  /** Last activity timestamp for one item */
  itemLastActivity: async (itemId: number, f: DateRangeFilter): Promise<string | null> => {
    const rows = await sequelize.query<{ last_activity: string | null }>(
      `SELECT MAX(created_at) AS last_activity FROM analytics_event
       WHERE item_id = :itemId AND created_at BETWEEN :from AND :to`,
      { replacements: { itemId, from: f.from, to: f.to }, type: QueryTypes.SELECT }
    );
    return rows[0]?.last_activity ?? null;
  },

  /** QR hashes seen in analytics events that had this item in context */
  itemLinkedQrHashes: async (itemId: number): Promise<string[]> => {
    const rows = await sequelize.query<{ qr_hash: string }>(
      `SELECT DISTINCT qr_hash FROM analytics_event
       WHERE item_id = :itemId AND qr_hash IS NOT NULL`,
      { replacements: { itemId }, type: QueryTypes.SELECT }
    );
    return rows.map(r => r.qr_hash);
  },

  /**
   * Per-item action breakdown for a specific event — the "Excel view".
   * Returns every item that had any action in the period, with column-per-action-type counts.
   * No LIMIT — callers get the full set.
   */
  itemsBreakdownByEvent: async (eventId: number, f: DateRangeFilter): Promise<Array<{
    itemId: number; itemName: string; itemType: string;
    expands: number; detailViews: number;
    whatsappClicks: number; shareClicks: number;
    directions: number; saves: number; calls: number;
    totalActions: number; lastActivity: string | null;
  }>> => {
    const rows = await sequelize.query<{
      item_id: string; item_name: string; item_type: string;
      expands: string; detail_views: string; whatsapp_clicks: string;
      share_clicks: string; directions: string; saves: string; calls: string;
      total_actions: string; last_activity: string | null;
    }>(
      `SELECT
         ae.item_id,
         COALESCE(li.display_name, li.name, ae.item_id::text)       AS item_name,
         COALESCE(li.type, 'item')                                   AS item_type,
         COUNT(*) FILTER (WHERE ae.action_type = 'item_expand')      AS expands,
         COUNT(*) FILTER (WHERE ae.action_type = 'item_detail_view') AS detail_views,
         COUNT(*) FILTER (WHERE ae.action_type = 'whatsapp_click')   AS whatsapp_clicks,
         COUNT(*) FILTER (WHERE ae.action_type = 'share_click')      AS share_clicks,
         COUNT(*) FILTER (WHERE ae.action_type = 'directions_click') AS directions,
         COUNT(*) FILTER (WHERE ae.action_type = 'save_contact')     AS saves,
         COUNT(*) FILTER (WHERE ae.action_type = 'call_click')       AS calls,
         COUNT(*)                                                     AS total_actions,
         MAX(ae.created_at)                                          AS last_activity
       FROM analytics_event ae
       LEFT JOIN line_item li ON li.id = ae.item_id
       WHERE ae.item_id IS NOT NULL
         AND ae.event_type = 'action'
         AND ae.event_id = :eventId
         AND ae.created_at BETWEEN :from AND :to
       GROUP BY ae.item_id, li.display_name, li.name, li.type
       ORDER BY total_actions DESC`,
      {
        replacements: { eventId, from: f.from, to: f.to },
        type: QueryTypes.SELECT,
      }
    );
    return rows.map(r => ({
      itemId:        Number(r.item_id),
      itemName:      r.item_name,
      itemType:      r.item_type,
      expands:       Number(r.expands),
      detailViews:   Number(r.detail_views),
      whatsappClicks: Number(r.whatsapp_clicks),
      shareClicks:   Number(r.share_clicks),
      directions:    Number(r.directions),
      saves:         Number(r.saves),
      calls:         Number(r.calls),
      totalActions:  Number(r.total_actions),
      lastActivity:  r.last_activity ?? null,
    }));
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

  /**
   * Raw event export for a vendor — one row per analytics event, enriched with
   * joined names so it makes sense in a spreadsheet.
   * Returns up to 50 000 rows (more than enough for any single vendor).
   */
  rawExport: async (vendorId: number, from: Date, to: Date): Promise<Array<Record<string, any>>> => {
    const rows = await sequelize.query<Record<string, any>>(
      `SELECT
         ae.id                                                                 AS "Event ID",
         ae.created_at                                                         AS "Timestamp",
         CASE ae.event_type
           WHEN 'qr_scan' THEN 'QR Scan'
           WHEN 'action'  THEN 'Action'
           ELSE ae.event_type
         END                                                                   AS "Event Type",
         CASE ae.action_type
           WHEN 'vendor_contact_view' THEN 'Contact Page View'
           WHEN 'menu_view'           THEN 'Menu View'
           WHEN 'item_detail_view'    THEN 'Item Detail View'
           WHEN 'item_expand'         THEN 'Item Expand'
           WHEN 'whatsapp_click'      THEN 'WhatsApp Click'
           WHEN 'call_click'          THEN 'Call Click'
           WHEN 'email_click'         THEN 'Email Click'
           WHEN 'directions_click'    THEN 'Directions Click'
           WHEN 'share_click'         THEN 'Share Click'
           WHEN 'save_contact'        THEN 'Save Contact'
           WHEN 'social_click'        THEN 'Social Link Click'
           ELSE COALESCE(ae.action_type, '—')
         END                                                                   AS "Action",
         CASE
           WHEN ae.event_type = 'qr_scan'                               THEN 'QR Redirect'
           WHEN ae.action_type = 'vendor_contact_view'                  THEN 'Contact Card'
           WHEN ae.action_type = 'menu_view'                            THEN 'Menu Page'
           WHEN ae.action_type IN ('item_expand', 'item_detail_view')   THEN 'Item Page'
           WHEN ae.item_id IS NOT NULL                                   THEN 'Item Page'
           WHEN ae.menu_id IS NOT NULL                                   THEN 'Menu Page'
           ELSE 'Contact Card'
         END                                                                   AS "Page Type",
         COALESCE(
           li.display_name, li.name,
           m.display_name,
           e.display_name,
           v.display_name,
           '—'
         )                                                                     AS "Page / Item Name",
         COALESCE(ae.resolved_url, ae.page_url, '—')                          AS "Page URL",
         COALESCE(ae.qr_hash, '—')                                            AS "QR Hash",
         COALESCE(ae.qr_status, '—')                                          AS "QR Status",
         COALESCE(ae.device_type, 'unknown')                                   AS "Device",
         SUBSTRING(MD5(COALESCE(ae.user_agent, 'unknown')), 1, 8)             AS "Session ID",
         COALESCE(ae.referrer, '—')                                            AS "Referrer",
         COALESCE(ae.user_agent, '—')                                          AS "User Agent",
         COALESCE(v.display_name, '—')                                         AS "Vendor"
       FROM  analytics_event ae
       LEFT JOIN qr_link_mapping qm ON qm.qr_hash = ae.qr_hash
       LEFT JOIN vendor    v  ON v.id  = COALESCE(ae.vendor_id, qm.vendor_id)
       LEFT JOIN event     e  ON e.id  = ae.event_id
       LEFT JOIN menu      m  ON m.id  = ae.menu_id
       LEFT JOIN line_item li ON li.id = ae.item_id
       WHERE (ae.vendor_id = :vendorId OR qm.vendor_id = :vendorId)
         AND ae.created_at BETWEEN :from AND :to
       ORDER BY ae.created_at DESC
       LIMIT 50000`,
      {
        replacements: { vendorId, from, to },
        type: QueryTypes.SELECT,
      }
    );
    return rows;
  },
};
