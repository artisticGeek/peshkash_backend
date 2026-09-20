import { Request, Response } from 'express';
import { QueryTypes } from 'sequelize';
import { sequelize } from '../config/sequelize';

type HistoryRow = {
  id: string; occurred_at: string; action_type: string; item_id: string;
  item_name: string; item_slug: string; image: string | null;
  menu_name: string | null; menu_slug: string | null;
  event_name: string | null; event_slug: string | null;
  vendor_name: string | null;
  event_start_time: string | null; event_end_time: string | null;
  item_is_active: boolean;
};

const RELEVANT = [
  'item_detail_view', 'item_expand', 'item_bookmark', 'item_unbookmark',
  'item_like', 'item_unlike', 'item_dislike', 'item_undislike', 'share_click',
];

async function rowsForPhone(phone: string, limit = 250): Promise<HistoryRow[]> {
  return sequelize.query<HistoryRow>(
    `SELECT ae.id, ae.created_at AS occurred_at, ae.action_type, ae.item_id,
            COALESCE(li.display_name, li.name) AS item_name, li.name AS item_slug, li.image,
            COALESCE(m.display_name, m.name) AS menu_name, m.name AS menu_slug,
            COALESCE(e.display_name, e.name) AS event_name, e.name AS event_slug,
            COALESCE(v.display_name, v.name) AS vendor_name,
            e.start_time AS event_start_time, e.end_time AS event_end_time,
            li.is_active AS item_is_active
       FROM analytics_event ae
       LEFT JOIN device_link dl ON dl.device_id = ae.device_id
       JOIN line_item li ON li.id = ae.item_id
       LEFT JOIN menu m ON m.id = COALESCE(ae.menu_id, li.menu_id)
       LEFT JOIN event e ON e.id = ae.event_id
       LEFT JOIN vendor v ON v.id = COALESCE(ae.vendor_id, e.vendor_id, m.vendor_id)
      WHERE COALESCE(dl.phone, ae.phone) = :phone
        AND ae.action_type IN (:actions)
      ORDER BY ae.created_at DESC, ae.id DESC
      LIMIT :limit`,
    { replacements: { phone, actions: RELEVANT, limit }, type: QueryTypes.SELECT },
  );
}

function publicPath(row: HistoryRow): string | null {
  return row.event_slug && row.menu_slug && row.item_slug
    ? `/event/${row.event_slug}/menu/${row.menu_slug}/item/${row.item_slug}`
    : null;
}

function shape(row: HistoryRow) {
  const now = Date.now();
  const hasWindow = Boolean(row.event_start_time && row.event_end_time);
  const eventExpired = hasWindow && new Date(row.event_end_time!).getTime() < now;
  const eventUpcoming = hasWindow && new Date(row.event_start_time!).getTime() > now;
  const availability = !row.item_is_active
    ? 'item_unavailable'
    : eventExpired
      ? 'event_expired'
      : eventUpcoming
        ? 'event_upcoming'
        : 'available';
  return {
    id: Number(row.id), itemId: Number(row.item_id), actionType: row.action_type,
    occurredAt: row.occurred_at, itemName: row.item_name, image: row.image,
    menuName: row.menu_name, eventName: row.event_name, vendorName: row.vendor_name,
    publicPath: publicPath(row),
    availability,
    availabilityLabel: availability === 'event_expired'
      ? 'Event ended'
      : availability === 'event_upcoming'
        ? 'Event not started'
        : availability === 'item_unavailable'
          ? 'Item unavailable'
          : null,
  };
}

function stateFrom(rows: HistoryRow[]) {
  const saved = new Map<string, HistoryRow>();
  const liked = new Map<string, HistoryRow>();
  const disliked = new Map<string, HistoryRow>();
  const seenSave = new Set<string>();
  const seenReaction = new Set<string>();
  for (const row of rows) {
    const key = String(row.item_id);
    if (!seenSave.has(key) && (row.action_type === 'item_bookmark' || row.action_type === 'item_unbookmark')) {
      seenSave.add(key);
      if (row.action_type === 'item_bookmark') saved.set(key, row);
    }
    if (!seenReaction.has(key) && ['item_like', 'item_unlike', 'item_dislike', 'item_undislike'].includes(row.action_type)) {
      seenReaction.add(key);
      if (row.action_type === 'item_like') liked.set(key, row);
      if (row.action_type === 'item_dislike') disliked.set(key, row);
    }
  }
  return { saved, liked, disliked };
}

export const UserHistoryController = {
  getHistory: async (req: Request, res: Response) => {
    try {
      const rows = await rowsForPhone(req.user!.phone);
      const { saved, liked, disliked } = stateFrom(rows);
      const uniqueItems = new Set(rows.map(r => r.item_id)).size;
      const uniqueVendors = new Set(rows.map(r => r.vendor_name).filter(Boolean)).size;
      return res.json({
        identity: { phone: req.user!.phone },
        summary: { savedCount: saved.size, likedCount: liked.size, dislikedCount: disliked.size, uniqueItems, uniqueVendors },
        saved: [...saved.values()].map(shape),
        liked: [...liked.values()].map(shape),
        disliked: [...disliked.values()].map(shape),
        recent: rows.slice(0, 100).map(shape),
      });
    } catch (error) {
      console.error('[UserHistory] getHistory error:', error);
      return res.status(500).json({ error: 'Your history is temporarily unavailable.' });
    }
  },

  getAuditHistory: async (req: Request, res: Response) => {
    try {
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(50, Math.max(5, Number(req.query.pageSize) || 20));
      const offset = (page - 1) * pageSize;
      const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
      const range = ['7d', '30d', '90d', 'all'].includes(String(req.query.range)) ? String(req.query.range) : '30d';
      const days = range === '7d' ? 7 : range === '90d' ? 90 : range === 'all' ? null : 30;
      const from = days == null ? new Date('2020-01-01T00:00:00.000Z') : new Date(Date.now() - days * 86_400_000);
      const replacements = {
        phone: req.user!.phone, actions: RELEVANT, from, q: `%${q}%`, limit: pageSize, offset,
      };
      const searchClause = q
        ? `AND (COALESCE(li.display_name, li.name) ILIKE :q
             OR COALESCE(v.display_name, v.name, '') ILIKE :q
             OR COALESCE(e.display_name, e.name, '') ILIKE :q
             OR COALESCE(m.display_name, m.name, '') ILIKE :q
             OR COALESCE(ae.action_type, '') ILIKE :q)`
        : '';
      const joins = `
        LEFT JOIN device_link dl ON dl.device_id = ae.device_id
        JOIN line_item li ON li.id = ae.item_id
        LEFT JOIN menu m ON m.id = COALESCE(ae.menu_id, li.menu_id)
        LEFT JOIN event e ON e.id = ae.event_id
        LEFT JOIN vendor v ON v.id = COALESCE(ae.vendor_id, e.vendor_id, m.vendor_id)`;
      const where = `
        WHERE COALESCE(dl.phone, ae.phone) = :phone
          AND ae.action_type IN (:actions)
          AND ae.created_at >= :from
          ${searchClause}`;
      const [rows, totals] = await Promise.all([
        sequelize.query<HistoryRow>(
          `SELECT ae.id, ae.created_at AS occurred_at, ae.action_type, ae.item_id,
                  COALESCE(li.display_name, li.name) AS item_name, li.name AS item_slug, li.image,
                  COALESCE(m.display_name, m.name) AS menu_name, m.name AS menu_slug,
                  COALESCE(e.display_name, e.name) AS event_name, e.name AS event_slug,
                  COALESCE(v.display_name, v.name) AS vendor_name,
                  e.start_time AS event_start_time, e.end_time AS event_end_time,
                  li.is_active AS item_is_active
             FROM analytics_event ae ${joins} ${where}
            ORDER BY ae.created_at DESC, ae.id DESC
            LIMIT :limit OFFSET :offset`,
          { replacements, type: QueryTypes.SELECT },
        ),
        sequelize.query<{ total: string }>(
          `SELECT COUNT(*) AS total FROM analytics_event ae ${joins} ${where}`,
          { replacements, type: QueryTypes.SELECT },
        ),
      ]);
      const total = Number(totals[0]?.total ?? 0);
      return res.json({
        rows: rows.map(shape), total, page, pageSize,
        pages: Math.max(1, Math.ceil(total / pageSize)), range, q,
      });
    } catch (error) {
      console.error('[UserHistory] getAuditHistory error:', error);
      return res.status(500).json({ error: 'Activity history is temporarily unavailable.' });
    }
  },

  getItemState: async (req: Request, res: Response) => {
    try {
      const itemId = Number(req.params.itemId);
      if (!Number.isFinite(itemId) || itemId <= 0) return res.status(400).json({ error: 'Invalid itemId' });
      const rows = (await rowsForPhone(req.user!.phone, 250)).filter(r => Number(r.item_id) === itemId);
      const { saved, liked } = stateFrom(rows);
      const latestReaction = rows.find(r => ['item_like', 'item_unlike', 'item_dislike', 'item_undislike'].includes(r.action_type));
      return res.json({
        saved: saved.has(String(itemId)),
        reaction: liked.has(String(itemId)) ? 'like' : latestReaction?.action_type === 'item_dislike' ? 'dislike' : null,
      });
    } catch (error) {
      console.error('[UserHistory] getItemState error:', error);
      return res.status(500).json({ error: 'Item state is temporarily unavailable.' });
    }
  },

  /**
   * Reconcile bookmarks created by older/local-only clients. Route slugs are
   * identifiers, not permission to read item details. Existing server state
   * always wins, including an explicit unbookmark from another device.
   */
  importLocalBookmarks: async (req: Request, res: Response) => {
    try {
      const refs = Array.isArray(req.body?.refs) ? req.body.refs.slice(0, 50) : [];
      let imported = 0;
      for (const ref of refs) {
        const eventName = typeof ref?.eventName === 'string' ? ref.eventName.slice(0, 180) : '';
        const menuName = typeof ref?.menuName === 'string' ? ref.menuName.slice(0, 180) : '';
        const itemName = typeof ref?.itemName === 'string' ? ref.itemName.slice(0, 180) : '';
        if (!eventName || !menuName || !itemName) continue;

        const items = await sequelize.query<{
          item_id: string; menu_id: string; event_id: string; vendor_id: string;
        }>(
          `SELECT li.id AS item_id, m.id AS menu_id, e.id AS event_id,
                  COALESCE(e.vendor_id, m.vendor_id) AS vendor_id
             FROM event_menu_mapping emm
             JOIN event e ON e.id = emm.event_id
             JOIN menu m ON m.id = emm.menu_id
             JOIN line_item li ON li.menu_id = m.id
            WHERE e.name = :eventName AND m.name = :menuName AND li.name = :itemName
            LIMIT 1`,
          { replacements: { eventName, menuName, itemName }, type: QueryTypes.SELECT },
        );
        const item = items[0];
        if (!item) continue;

        const existing = await sequelize.query<{ action_type: string }>(
          `SELECT ae.action_type
             FROM analytics_event ae
             LEFT JOIN device_link dl ON dl.device_id = ae.device_id
            WHERE COALESCE(dl.phone, ae.phone) = :phone
              AND ae.item_id = :itemId
              AND ae.action_type IN ('item_bookmark', 'item_unbookmark')
            ORDER BY ae.created_at DESC, ae.id DESC
            LIMIT 1`,
          { replacements: { phone: req.user!.phone, itemId: item.item_id }, type: QueryTypes.SELECT },
        );
        if (existing.length) continue;

        await sequelize.query(
          `INSERT INTO analytics_event
             (event_type, action_type, vendor_id, event_id, menu_id, item_id, phone, page_url, created_at)
           VALUES
             ('action', 'item_bookmark', :vendorId, :eventId, :menuId, :itemId, :phone, :pageUrl, NOW())`,
          {
            replacements: {
              vendorId: item.vendor_id, eventId: item.event_id, menuId: item.menu_id,
              itemId: item.item_id, phone: req.user!.phone,
              pageUrl: `/event/${eventName}/menu/${menuName}/item/${itemName}`,
            },
          },
        );
        imported++;
      }
      return res.json({ imported });
    } catch (error) {
      console.error('[UserHistory] importLocalBookmarks error:', error);
      return res.status(500).json({ error: 'Could not reconcile local bookmarks.' });
    }
  },

  getCommunicationPreferences: async (req: Request, res: Response) => {
    try {
      const rows = await sequelize.query<{
        vendor_id: string; vendor_name: string; last_interaction: string;
        whatsapp_status: string | null; push_status: string | null;
      }>(
        `WITH interacted AS (
           SELECT ae.vendor_id, MAX(ae.created_at) AS last_interaction
             FROM analytics_event ae
             LEFT JOIN device_link dl ON dl.device_id = ae.device_id
            WHERE COALESCE(dl.phone, ae.phone) = :phone
              AND ae.vendor_id IS NOT NULL
            GROUP BY ae.vendor_id
         )
         SELECT i.vendor_id, COALESCE(v.display_name, v.name) AS vendor_name,
                i.last_interaction, wc.status AS whatsapp_status, pc.status AS push_status
           FROM interacted i
           JOIN vendor v ON v.id = i.vendor_id
           LEFT JOIN communication_consent wc
             ON wc.phone = :phone AND wc.vendor_id = i.vendor_id
            AND wc.channel = 'whatsapp' AND wc.purpose = 'vendor_updates'
           LEFT JOIN communication_consent pc
             ON pc.phone = :phone AND pc.vendor_id = i.vendor_id
            AND pc.channel = 'push' AND pc.purpose = 'vendor_updates'
          ORDER BY i.last_interaction DESC`,
        { replacements: { phone: req.user!.phone }, type: QueryTypes.SELECT },
      );
      return res.json({
        sender: 'Peshkash Updates',
        vendors: rows.map(row => ({
          vendorId: Number(row.vendor_id), vendorName: row.vendor_name,
          lastInteraction: row.last_interaction,
          whatsappEnabled: row.whatsapp_status === 'granted',
          pushEnabled: row.push_status === 'granted',
        })),
      });
    } catch (error) {
      console.error('[UserHistory] preferences error:', error);
      return res.status(500).json({ error: 'Communication preferences are temporarily unavailable.' });
    }
  },

  updateCommunicationPreference: async (req: Request, res: Response) => {
    const vendorId = Number(req.params.vendorId);
    const enabled = req.body?.whatsappEnabled;
    if (!Number.isFinite(vendorId) || vendorId <= 0 || typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'A valid vendor and preference are required.' });
    }
    try {
      const interacted = await sequelize.query<{ exists: boolean }>(
        `SELECT true AS exists
           FROM analytics_event ae
           LEFT JOIN device_link dl ON dl.device_id = ae.device_id
          WHERE COALESCE(dl.phone, ae.phone) = :phone AND ae.vendor_id = :vendorId
          LIMIT 1`,
        { replacements: { phone: req.user!.phone, vendorId }, type: QueryTypes.SELECT },
      );
      if (!interacted.length) return res.status(403).json({ error: 'This vendor is not part of your Peshkash history.' });
      await sequelize.query(
        `INSERT INTO communication_consent
           (phone, vendor_id, channel, purpose, status, source, consented_at, revoked_at, created_at, updated_at)
         VALUES
           (:phone, :vendorId, 'whatsapp', 'vendor_updates', :status, 'user_preferences',
            CASE WHEN :enabled THEN NOW() ELSE NULL END,
            CASE WHEN :enabled THEN NULL ELSE NOW() END, NOW(), NOW())
         ON CONFLICT (phone, vendor_id, channel, purpose) DO UPDATE SET
           status = EXCLUDED.status,
           source = EXCLUDED.source,
           consented_at = CASE WHEN :enabled THEN NOW() ELSE communication_consent.consented_at END,
           revoked_at = CASE WHEN :enabled THEN NULL ELSE NOW() END,
           updated_at = NOW()`,
        { replacements: { phone: req.user!.phone, vendorId, status: enabled ? 'granted' : 'revoked', enabled } },
      );
      return res.json({ vendorId, whatsappEnabled: enabled });
    } catch (error) {
      console.error('[UserHistory] update preference error:', error);
      return res.status(500).json({ error: 'Could not update this preference.' });
    }
  },

  getPushConfig: async (_req: Request, res: Response) => {
    const publicKey = process.env.VAPID_PUBLIC_KEY || '';
    return res.json({ enabled: Boolean(publicKey && process.env.VAPID_PRIVATE_KEY), publicKey });
  },

  subscribeToPush: async (req: Request, res: Response) => {
    const vendorId = Number(req.body?.vendorId);
    const subscription = req.body?.subscription;
    if (!Number.isFinite(vendorId) || vendorId <= 0 || typeof subscription?.endpoint !== 'string'
      || typeof subscription?.keys?.p256dh !== 'string' || typeof subscription?.keys?.auth !== 'string') {
      return res.status(400).json({ error: 'A valid vendor and browser subscription are required.' });
    }
    try {
      const interacted = await sequelize.query<{ exists: boolean }>(
        `SELECT true AS exists FROM analytics_event ae
          LEFT JOIN device_link dl ON dl.device_id = ae.device_id
         WHERE COALESCE(dl.phone, ae.phone) = :phone AND ae.vendor_id = :vendorId LIMIT 1`,
        { replacements: { phone: req.user!.phone, vendorId }, type: QueryTypes.SELECT },
      );
      if (!interacted.length) return res.status(403).json({ error: 'This vendor is not part of your Peshkash history.' });
      await sequelize.transaction(async transaction => {
        await sequelize.query(
          `INSERT INTO push_subscription (phone, endpoint, subscription, user_agent, active, created_at, updated_at)
           VALUES (:phone, :endpoint, CAST(:subscription AS jsonb), :userAgent, true, NOW(), NOW())
           ON CONFLICT (endpoint) DO UPDATE SET phone = :phone, subscription = CAST(:subscription AS jsonb),
             user_agent = :userAgent, active = true, updated_at = NOW()`,
          { replacements: { phone: req.user!.phone, endpoint: subscription.endpoint, subscription: JSON.stringify(subscription), userAgent: req.get('user-agent') || null }, transaction },
        );
        await sequelize.query(
          `INSERT INTO communication_consent
             (phone, vendor_id, channel, purpose, status, source, consented_at, revoked_at, created_at, updated_at)
           VALUES (:phone, :vendorId, 'push', 'vendor_updates', 'granted', 'browser_permission', NOW(), NULL, NOW(), NOW())
           ON CONFLICT (phone, vendor_id, channel, purpose) DO UPDATE SET
             status = 'granted', source = 'browser_permission', consented_at = NOW(), revoked_at = NULL, updated_at = NOW()`,
          { replacements: { phone: req.user!.phone, vendorId }, transaction },
        );
      });
      return res.json({ vendorId, pushEnabled: true });
    } catch (error) {
      console.error('[UserHistory] push subscribe error:', error);
      return res.status(500).json({ error: 'Could not enable browser notifications.' });
    }
  },

  unsubscribeFromPush: async (req: Request, res: Response) => {
    const vendorId = Number(req.params.vendorId);
    if (!Number.isFinite(vendorId) || vendorId <= 0) return res.status(400).json({ error: 'Invalid vendor.' });
    try {
      await sequelize.query(
        `INSERT INTO communication_consent
           (phone, vendor_id, channel, purpose, status, source, consented_at, revoked_at, created_at, updated_at)
         VALUES (:phone, :vendorId, 'push', 'vendor_updates', 'revoked', 'user_preferences', NULL, NOW(), NOW(), NOW())
         ON CONFLICT (phone, vendor_id, channel, purpose) DO UPDATE SET
           status = 'revoked', revoked_at = NOW(), updated_at = NOW()`,
        { replacements: { phone: req.user!.phone, vendorId } },
      );
      return res.json({ vendorId, pushEnabled: false });
    } catch (error) {
      console.error('[UserHistory] push unsubscribe error:', error);
      return res.status(500).json({ error: 'Could not disable browser notifications.' });
    }
  },
};
