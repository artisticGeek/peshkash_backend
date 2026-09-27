import { Request, Response } from 'express';
import { createHmac } from 'crypto';
import { QueryTypes } from 'sequelize';
import { sequelize } from '../config/sequelize';
import { pushConfigured, sendPush, sendWhatsApp, whatsappConfigured } from '../services/EngagementDeliveryService';

type CampaignRow = {
  id: string; vendor_id: string; channel: string; title: string; message: string;
  template_key: string | null; status: string; recipient_count: number;
  audience_filter?: AudienceFilter;
  audience_label?: string; audience_snapshot?: AudienceSnapshot[]; destination_path?: string;
  send_count?: number; last_sent_at?: string | null;
  created_at: string; updated_at: string;
};

type SendCampaignRow = CampaignRow & { vendor_name: string };

type AudienceMode = 'all' | 'list' | 'collection' | 'event' | 'product' | 'source' | 'custom';
type AudienceFilter = { mode: AudienceMode; value: string | null; recipientKeys: string[] };
type AudienceCandidateRow = {
  phone: string; last_interaction: string; activity_count: string;
  actions: string[] | null; events: string[] | null; collections: string[] | null; products: string[] | null;
};
type AudienceSnapshot = {
  key: string; phone: string; maskedPhone: string; lastInteraction: string; activityCount: number;
  actions: string[]; events: string[]; collections: string[]; products: string[]; origin: string;
};
type NamedOptionRow = { id: string; name: string; slug?: string | null; event_slug?: string | null; menu_slug?: string | null };

const AUDIENCE_MODES = new Set<AudienceMode>(['all', 'list', 'collection', 'event', 'product', 'source', 'custom']);
const LIST_VALUES = new Set(['saved', 'liked', 'visited', 'disliked']);
const SOURCE_VALUES = new Set(['qr', 'direct', 'social', 'shared']);

function parseAudienceFilter(input: any): AudienceFilter {
  const mode = AUDIENCE_MODES.has(input?.mode) ? input.mode as AudienceMode : 'all';
  const rawValue = input?.value == null ? null : String(input.value).slice(0, 80);
  const value = mode === 'list' && !LIST_VALUES.has(rawValue || '')
    ? null
    : mode === 'source' && !SOURCE_VALUES.has(rawValue || '') ? null : rawValue;
  const recipientKeys = Array.isArray(input?.recipientKeys)
    ? [...new Set(input.recipientKeys.filter((key: unknown) => typeof key === 'string' && /^[a-f0-9]{64}$/.test(key)).slice(0, 2000))] as string[]
    : [];
  return { mode, value, recipientKeys };
}

function audienceKey(phone: string): string {
  return createHmac('sha256', process.env.JWT_SECRET || 'peshkash-audience-key')
    .update(phone)
    .digest('hex');
}

function maskedPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length > 4 ? `••••••${digits.slice(-4)}` : 'Signed-in user';
}

function audienceActivityClause(filter: AudienceFilter, replacements: Record<string, unknown>): string {
  if (filter.mode === 'event' && /^\d+$/.test(filter.value || '')) {
    replacements.audienceEventId = Number(filter.value);
    return 'AND ae.event_id = :audienceEventId';
  }
  if (filter.mode === 'collection' && /^\d+$/.test(filter.value || '')) {
    replacements.audienceMenuId = Number(filter.value);
    return 'AND ae.menu_id = :audienceMenuId';
  }
  if (filter.mode === 'product' && /^\d+$/.test(filter.value || '')) {
    replacements.audienceItemId = Number(filter.value);
    return 'AND ae.item_id = :audienceItemId';
  }
  if (filter.mode === 'list') {
    const actionMap: Record<string, string[]> = {
      saved: ['item_bookmark'], liked: ['item_like'],
      visited: ['item_detail_view', 'item_expand'], disliked: ['item_dislike'],
    };
    const actions = actionMap[filter.value || ''] || [];
    if (actions.length) {
      replacements.audienceActions = actions;
      return 'AND ae.action_type IN (:audienceActions)';
    }
  }
  if (filter.mode === 'source') {
    if (filter.value === 'qr') return "AND (ae.event_type = 'qr_scan' OR ae.qr_hash IS NOT NULL)";
    if (filter.value === 'direct') return "AND COALESCE(ae.referrer, '') = ''";
    if (filter.value === 'social') return "AND COALESCE(ae.referrer, '') ~* '(instagram|facebook|linkedin|youtube|tiktok|twitter|x\\.com)'";
    if (filter.value === 'shared') return "AND ae.action_type = 'share_click'";
  }
  return '';
}

async function loadAudienceCandidates(vendorId: number, channel: 'whatsapp' | 'push', filter: AudienceFilter) {
  const replacements: Record<string, unknown> = { vendorId, channel };
  if (filter.mode === 'custom') {
    const selected = new Set(filter.recipientKeys);
    if (!selected.size) return [];
    const eligible = await sequelize.query<AudienceCandidateRow>(
      `WITH eligible_preference AS (
         SELECT preference.phone FROM user_communication_preference preference
          WHERE preference.channel = :channel AND preference.status = 'granted'
            AND (:channel <> 'push' OR EXISTS (
              SELECT 1 FROM push_subscription ps WHERE ps.phone = preference.phone AND ps.active = true
            ))
         UNION
         SELECT ps.phone FROM push_subscription ps WHERE :channel = 'push' AND ps.active = true
       )
       SELECT preference.phone, MAX(ae.created_at) AS last_interaction,
              COUNT(ae.id)::text AS activity_count,
              ARRAY_REMOVE(ARRAY_AGG(DISTINCT ae.action_type), NULL) AS actions,
              ARRAY_REMOVE(ARRAY_AGG(DISTINCT COALESCE(event.display_name, event.name)), NULL) AS events,
              ARRAY_REMOVE(ARRAY_AGG(DISTINCT COALESCE(menu.display_name, menu.name)), NULL) AS collections,
              ARRAY_REMOVE(ARRAY_AGG(DISTINCT COALESCE(item.display_name, item.name)), NULL) AS products
         FROM eligible_preference preference
         LEFT JOIN analytics_event ae ON ae.vendor_id = :vendorId
          AND (ae.phone = preference.phone OR EXISTS (
            SELECT 1 FROM device_link dl WHERE dl.device_id = ae.device_id AND dl.phone = preference.phone
          ))
         LEFT JOIN event ON event.id = ae.event_id
         LEFT JOIN menu ON menu.id = ae.menu_id
         LEFT JOIN line_item item ON item.id = ae.item_id
        GROUP BY preference.phone`,
      { replacements, type: QueryTypes.SELECT },
    );
    return eligible.map(row => ({ ...row, key: audienceKey(row.phone) })).filter(row => selected.has(row.key));
  }
  const activityClause = audienceActivityClause(filter, replacements);
  const rows = await sequelize.query<AudienceCandidateRow>(
    `WITH eligible_preference AS (
       SELECT preference.phone FROM user_communication_preference preference
        WHERE preference.channel = :channel AND preference.status = 'granted'
          AND (:channel <> 'push' OR EXISTS (
            SELECT 1 FROM push_subscription ps WHERE ps.phone = preference.phone AND ps.active = true
          ))
       UNION
       SELECT ps.phone FROM push_subscription ps WHERE :channel = 'push' AND ps.active = true
     )
     SELECT preference.phone, MAX(ae.created_at) AS last_interaction,
            COUNT(*)::text AS activity_count,
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT ae.action_type), NULL) AS actions,
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT COALESCE(event.display_name, event.name)), NULL) AS events,
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT COALESCE(menu.display_name, menu.name)), NULL) AS collections,
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT COALESCE(item.display_name, item.name)), NULL) AS products
       FROM eligible_preference preference
       JOIN analytics_event ae ON ae.vendor_id = :vendorId
       LEFT JOIN device_link dl ON dl.device_id = ae.device_id
       LEFT JOIN event ON event.id = ae.event_id
       LEFT JOIN menu ON menu.id = ae.menu_id
       LEFT JOIN line_item item ON item.id = ae.item_id
      WHERE COALESCE(dl.phone, ae.phone) = preference.phone
        ${activityClause}
      GROUP BY preference.phone
      ORDER BY MAX(ae.created_at) DESC`,
    { replacements, type: QueryTypes.SELECT },
  );
  const keyed = rows.map(row => ({ ...row, key: audienceKey(row.phone) }));
  return keyed;
}

function normalisePhone(input: unknown): string | null {
  const digits = String(input || '').replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return null;
}

function safeDestinationPath(input: unknown): string {
  const value = typeof input === 'string' ? input.trim().slice(0, 500) : '';
  return /^\/(?!\/)(home(?:\/[^\s]*)?|event\/[^\s]+|vendor\/[^\s]+)$/.test(value)
    ? value
    : '/home/history';
}

async function audienceLabelFor(vendorId: number, filter: AudienceFilter): Promise<string> {
  if (filter.mode === 'all') return 'All eligible subscribers';
  if (filter.mode === 'custom') return 'Custom recipient list';
  const fixed: Record<string, string> = {
    'list:saved': 'People who saved items', 'list:liked': 'People who liked items',
    'list:visited': 'People who viewed items', 'list:disliked': 'People who disliked items',
    'source:qr': 'Visitors from QR scans', 'source:direct': 'Direct visitors',
    'source:social': 'Visitors from social links', 'source:shared': 'People who shared an item',
  };
  if (fixed[`${filter.mode}:${filter.value}`]) return fixed[`${filter.mode}:${filter.value}`];
  if (!/^\d+$/.test(filter.value || '')) return 'Filtered subscribers';
  const config = filter.mode === 'event'
    ? { table: 'event', prefix: 'Event' }
    : filter.mode === 'collection'
      ? { table: 'menu', prefix: 'Collection' }
      : { table: 'line_item', prefix: 'Product' };
  const rows = await sequelize.query<{ name: string }>(
    `SELECT COALESCE(NULLIF(source.display_name, ''), source.name) AS name
       FROM ${config.table} source
      ${filter.mode === 'product' ? 'JOIN menu ON menu.id = source.menu_id' : ''}
      WHERE source.id = :id AND ${filter.mode === 'product' ? 'menu.vendor_id' : 'source.vendor_id'} = :vendorId LIMIT 1`,
    { replacements: { id: Number(filter.value), vendorId }, type: QueryTypes.SELECT },
  );
  return rows[0]?.name ? `${config.prefix}: ${rows[0].name}` : `${config.prefix} audience`;
}

function snapshotCandidates(candidates: Awaited<ReturnType<typeof loadAudienceCandidates>>, origin: string): AudienceSnapshot[] {
  return candidates.map(candidate => ({
    key: candidate.key, phone: candidate.phone,
    maskedPhone: maskedPhone(candidate.phone),
    lastInteraction: candidate.last_interaction,
    activityCount: Number(candidate.activity_count),
    actions: candidate.actions || [], events: candidate.events || [],
    collections: candidate.collections || [], products: candidate.products || [],
    origin: Number(candidate.activity_count || 0) > 0 ? origin : 'Eligible Peshkash subscriber',
  }));
}

function vendorIdFor(req: Request): number | null {
  if (req.user?.role === 'vendor') return req.user.vendorId ?? null;
  const value = Number(req.method === 'GET' ? req.query.vendorId : req.body?.vendorId);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function shapeCampaign(row: CampaignRow) {
  return {
    id: Number(row.id), vendorId: Number(row.vendor_id), channel: row.channel,
    title: row.title, message: row.message, templateKey: row.template_key,
    status: row.status, recipientCount: Number(row.recipient_count || 0),
    audienceFilter: row.audience_filter || { mode: 'all', value: null, recipientKeys: [] },
    audienceLabel: row.audience_label || 'All eligible subscribers',
    destinationPath: row.destination_path || '/home/history',
    sendCount: Number(row.send_count || 0), lastSentAt: row.last_sent_at || null,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export const EngagementController = {
  overview: async (req: Request, res: Response) => {
    const vendorId = vendorIdFor(req);
    if (!vendorId) return res.status(400).json({ error: 'Select a vendor first.' });
    try {
      const [audienceRows, consentRows, campaigns] = await Promise.all([
        sequelize.query<{ known: string; recent: string; engaged: string }>(
          `SELECT
             COUNT(DISTINCT COALESCE(dl.phone, ae.phone)) FILTER
               (WHERE COALESCE(dl.phone, ae.phone) IS NOT NULL) AS known,
             COUNT(DISTINCT COALESCE(dl.phone, ae.phone)) FILTER
               (WHERE COALESCE(dl.phone, ae.phone) IS NOT NULL
                  AND ae.created_at >= NOW() - INTERVAL '30 days') AS recent,
             COUNT(DISTINCT COALESCE(dl.phone, ae.phone)) FILTER
               (WHERE COALESCE(dl.phone, ae.phone) IS NOT NULL
                  AND ae.action_type IN ('item_bookmark','item_like','item_dislike','item_detail_view','item_expand')) AS engaged
           FROM analytics_event ae
           LEFT JOIN device_link dl ON dl.device_id = ae.device_id
          WHERE ae.vendor_id = :vendorId`,
          { replacements: { vendorId }, type: QueryTypes.SELECT },
        ),
        sequelize.query<{ channel: string; total: string }>(
          `SELECT preference.channel, COUNT(DISTINCT preference.phone) AS total
             FROM user_communication_preference preference
            WHERE preference.status = 'granted'
              AND EXISTS (
                SELECT 1 FROM analytics_event ae
                LEFT JOIN device_link dl ON dl.device_id = ae.device_id
                WHERE COALESCE(dl.phone, ae.phone) = preference.phone
                  AND ae.vendor_id = :vendorId
              )
            GROUP BY preference.channel`,
          { replacements: { vendorId }, type: QueryTypes.SELECT },
        ),
        sequelize.query<CampaignRow>(
          `SELECT id, vendor_id, channel, title, message, template_key, status,
                  recipient_count, audience_filter, audience_label, destination_path,
                  send_count, last_sent_at, created_at, updated_at
             FROM engagement_campaign
            WHERE vendor_id = :vendorId
            ORDER BY created_at DESC
            LIMIT 25`,
          { replacements: { vendorId }, type: QueryTypes.SELECT },
        ),
      ]);
      const consents = Object.fromEntries(consentRows.map(row => [row.channel, Number(row.total)]));
      const audience = audienceRows[0] ?? { known: '0', recent: '0', engaged: '0' };
      return res.json({
        vendorId,
        sender: {
          name: 'Peshkash Updates',
          whatsapp: process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID
            ? 'configured'
            : 'not_configured',
          push: process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
            ? 'configured'
            : 'not_configured',
        },
        audience: {
          knownUsers: Number(audience.known),
          recentlyActive: Number(audience.recent),
          engagedUsers: Number(audience.engaged),
          whatsappOptedIn: consents.whatsapp ?? 0,
          pushOptedIn: consents.push ?? 0,
        },
        campaigns: campaigns.map(shapeCampaign),
      });
    } catch (error) {
      console.error('[Engagement] overview error:', error);
      return res.status(500).json({ error: 'Engagement workspace is temporarily unavailable.' });
    }
  },

  audiencePreview: async (req: Request, res: Response) => {
    const vendorId = vendorIdFor(req);
    const channel = req.query.channel === 'push' ? 'push' : 'whatsapp';
    const filter = parseAudienceFilter({
      mode: req.query.mode,
      value: req.query.value,
      recipientKeys: typeof req.query.recipientKeys === 'string'
        ? req.query.recipientKeys.split(',')
        : [],
    });
    if (!vendorId) return res.status(400).json({ error: 'Select a vendor first.' });
    try {
      const previewFilter = filter.mode === 'custom'
        ? { mode: 'all' as const, value: null, recipientKeys: [] }
        : filter;
      const [candidates, events, collections, products] = await Promise.all([
        loadAudienceCandidates(vendorId, channel, previewFilter),
        sequelize.query<NamedOptionRow>(
          `SELECT id, COALESCE(NULLIF(display_name, ''), name) AS name, name AS slug
             FROM event WHERE vendor_id = :vendorId ORDER BY created_at DESC`,
          { replacements: { vendorId }, type: QueryTypes.SELECT },
        ),
        sequelize.query<NamedOptionRow>(
          `SELECT menu.id, COALESCE(NULLIF(menu.display_name, ''), menu.name) AS name,
                  menu.name AS slug, recent_event.name AS event_slug
             FROM menu
             LEFT JOIN LATERAL (
               SELECT event.name FROM event_menu_mapping mapping
               JOIN event ON event.id = mapping.event_id
               WHERE mapping.menu_id = menu.id ORDER BY event.created_at DESC LIMIT 1
             ) recent_event ON true
            WHERE menu.vendor_id = :vendorId ORDER BY menu.created_at DESC`,
          { replacements: { vendorId }, type: QueryTypes.SELECT },
        ),
        sequelize.query<NamedOptionRow>(
          `SELECT item.id, COALESCE(NULLIF(item.display_name, ''), item.name) AS name,
                  item.name AS slug, menu.name AS menu_slug, recent_event.name AS event_slug
             FROM line_item item
             JOIN menu ON menu.id = item.menu_id
             LEFT JOIN LATERAL (
               SELECT event.name FROM event_menu_mapping mapping
               JOIN event ON event.id = mapping.event_id
               WHERE mapping.menu_id = menu.id ORDER BY event.created_at DESC LIMIT 1
             ) recent_event ON true
            WHERE menu.vendor_id = :vendorId AND COALESCE(item.is_active, true) = true
            ORDER BY item.created_at DESC LIMIT 500`,
          { replacements: { vendorId }, type: QueryTypes.SELECT },
        ),
      ]);
      const selected = new Set(filter.recipientKeys);
      return res.json({
        mode: filter.mode,
        total: filter.mode === 'custom'
          ? candidates.filter(candidate => selected.has(candidate.key)).length
          : candidates.length,
        eligibleTotal: candidates.length,
        recipients: candidates.map(candidate => ({
          key: candidate.key,
          phone: candidate.phone,
          maskedPhone: maskedPhone(candidate.phone),
          lastInteraction: candidate.last_interaction,
          activityCount: Number(candidate.activity_count),
          actions: candidate.actions || [],
          events: candidate.events || [],
          collections: candidate.collections || [],
          products: candidate.products || [],
          selected: filter.mode !== 'custom' || selected.has(candidate.key),
        })),
        options: {
          events: events.map(event => ({ id: Number(event.id), name: event.name, path: `/event/${encodeURIComponent(event.slug || '')}` })),
          collections: collections.map(collection => ({
            id: Number(collection.id), name: collection.name,
            path: collection.event_slug ? `/event/${encodeURIComponent(collection.event_slug)}/menu/${encodeURIComponent(collection.slug || '')}` : '/home/saved',
          })),
          products: products.map(product => ({
            id: Number(product.id), name: product.name,
            path: product.event_slug
              ? `/event/${encodeURIComponent(product.event_slug)}/menu/${encodeURIComponent(product.menu_slug || '')}/item/${encodeURIComponent(product.slug || '')}`
              : '/home/saved',
          })),
          lists: [
            { id: 'saved', name: 'Saved items' }, { id: 'liked', name: 'Liked items' },
            { id: 'visited', name: 'Visited items' }, { id: 'disliked', name: 'Disliked items' },
          ],
          sources: [
            { id: 'qr', name: 'QR scans' }, { id: 'direct', name: 'Direct visits' },
            { id: 'social', name: 'Social referrals' }, { id: 'shared', name: 'People who shared' },
          ],
        },
      });
    } catch (error) {
      console.error('[Engagement] audience preview error:', error);
      return res.status(500).json({ error: 'Could not build this audience.' });
    }
  },

  recipientDirectory: async (req: Request, res: Response) => {
    const vendorId = vendorIdFor(req);
    const channel = req.query.channel === 'whatsapp' ? 'whatsapp' : 'push';
    if (!vendorId) return res.status(400).json({ error: 'Select a vendor first.' });
    try {
      const rows = await sequelize.query<AudienceCandidateRow>(
        `WITH eligible_preference AS (
           SELECT preference.phone FROM user_communication_preference preference
            WHERE preference.channel = :channel AND preference.status = 'granted'
              AND (:channel <> 'push' OR EXISTS (
                SELECT 1 FROM push_subscription ps WHERE ps.phone = preference.phone AND ps.active = true
              ))
           UNION
           SELECT ps.phone FROM push_subscription ps WHERE :channel = 'push' AND ps.active = true
         )
         SELECT preference.phone, MAX(ae.created_at) AS last_interaction,
                COUNT(ae.id)::text AS activity_count,
                ARRAY_REMOVE(ARRAY_AGG(DISTINCT ae.action_type), NULL) AS actions,
                ARRAY_REMOVE(ARRAY_AGG(DISTINCT COALESCE(event.display_name, event.name)), NULL) AS events,
                ARRAY_REMOVE(ARRAY_AGG(DISTINCT COALESCE(menu.display_name, menu.name)), NULL) AS collections,
                ARRAY_REMOVE(ARRAY_AGG(DISTINCT COALESCE(item.display_name, item.name)), NULL) AS products
           FROM eligible_preference preference
           LEFT JOIN analytics_event ae ON ae.vendor_id = :vendorId
            AND (ae.phone = preference.phone OR EXISTS (
              SELECT 1 FROM device_link dl WHERE dl.device_id = ae.device_id AND dl.phone = preference.phone
            ))
           LEFT JOIN event ON event.id = ae.event_id
           LEFT JOIN menu ON menu.id = ae.menu_id
           LEFT JOIN line_item item ON item.id = ae.item_id
          GROUP BY preference.phone ORDER BY MAX(ae.created_at) DESC NULLS LAST`,
        { replacements: { vendorId, channel }, type: QueryTypes.SELECT },
      );
      return res.json({
        channel,
        recipients: rows.map(row => ({
          key: audienceKey(row.phone), phone: row.phone, maskedPhone: maskedPhone(row.phone),
          lastInteraction: row.last_interaction, activityCount: Number(row.activity_count || 0),
          actions: row.actions || [], events: row.events || [], collections: row.collections || [],
          products: row.products || [], origin: Number(row.activity_count || 0) ? 'Vendor activity' : 'Eligible Peshkash subscriber',
        })),
      });
    } catch (error) {
      console.error('[Engagement] recipient directory error:', error);
      return res.status(500).json({ error: 'Could not load eligible recipients.' });
    }
  },

  checkEligibleRecipient: async (req: Request, res: Response) => {
    const vendorId = vendorIdFor(req);
    const channel = req.body?.channel === 'push' ? 'push' : 'whatsapp';
    const phone = normalisePhone(req.body?.phone);
    if (!vendorId || !phone) return res.status(400).json({ error: 'Enter a valid phone number.' });
    try {
      const rows = await sequelize.query<{ phone: string; last_interaction: string | null; activity_count: string }>(
        `WITH eligible_phone AS (
           SELECT preference.phone FROM user_communication_preference preference
            WHERE preference.phone = :phone AND preference.channel = :channel
              AND preference.status = 'granted'
           UNION
           SELECT ps.phone FROM push_subscription ps
            WHERE :channel = 'push' AND ps.phone = :phone AND ps.active = true
         )
         SELECT preference.phone, MAX(ae.created_at) AS last_interaction, COUNT(ae.id)::text AS activity_count
           FROM eligible_phone preference
           LEFT JOIN analytics_event ae ON ae.vendor_id = :vendorId
            AND (ae.phone = preference.phone OR EXISTS (
              SELECT 1 FROM device_link dl WHERE dl.device_id = ae.device_id AND dl.phone = preference.phone
            ))
          GROUP BY preference.phone LIMIT 1`,
        { replacements: { vendorId, phone, channel }, type: QueryTypes.SELECT },
      );
      const recipient = rows[0];
      if (!recipient) return res.status(404).json({ error: `This person has not opted in to ${channel === 'push' ? 'Peshkash notifications' : 'WhatsApp updates'}.` });
      return res.json({
        recipient: {
          key: audienceKey(recipient.phone), phone: recipient.phone, maskedPhone: maskedPhone(recipient.phone),
          lastInteraction: recipient.last_interaction, activityCount: Number(recipient.activity_count || 0),
          actions: [], events: [], collections: [], products: [], selected: true,
          origin: recipient.last_interaction ? 'Vendor activity' : 'Eligible Peshkash subscriber',
        },
      });
    } catch (error) {
      console.error('[Engagement] recipient eligibility error:', error);
      return res.status(500).json({ error: 'Could not verify this recipient.' });
    }
  },

  createDraft: async (req: Request, res: Response) => {
    const vendorId = vendorIdFor(req);
    const channel = req.body?.channel === 'push' ? 'push' : 'whatsapp';
    const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 120) : '';
    const message = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 1200) : '';
    const templateKey = typeof req.body?.templateKey === 'string' ? req.body.templateKey.trim().slice(0, 100) : null;
    const audienceFilter = parseAudienceFilter(req.body?.audienceFilter);
    const destinationPath = safeDestinationPath(req.body?.destinationPath);
    if (!vendorId) return res.status(400).json({ error: 'Select a vendor first.' });
    if (!title || !message) return res.status(400).json({ error: 'Campaign title and message are required.' });
    try {
      const [candidates, audienceLabel] = await Promise.all([
        loadAudienceCandidates(vendorId, channel, audienceFilter),
        audienceLabelFor(vendorId, audienceFilter),
      ]);
      const audienceSnapshot = snapshotCandidates(candidates, audienceLabel);
      const rows = await sequelize.query<CampaignRow>(
        `INSERT INTO engagement_campaign
           (vendor_id, channel, title, message, template_key, status, audience_filter,
            audience_label, audience_snapshot, destination_path, recipient_count,
            created_by, created_at, updated_at)
         VALUES
           (:vendorId, :channel, :title, :message, :templateKey, 'draft',
            CAST(:audienceFilter AS jsonb), :audienceLabel, CAST(:audienceSnapshot AS jsonb),
            :destinationPath, :recipientCount, :createdBy, NOW(), NOW())
         RETURNING id, vendor_id, channel, title, message, template_key, status,
                   recipient_count, audience_filter, audience_label, destination_path,
                   send_count, last_sent_at, created_at, updated_at`,
        {
          replacements: {
            vendorId, channel, title, message, templateKey,
            audienceFilter: JSON.stringify(audienceFilter),
            audienceLabel,
            audienceSnapshot: JSON.stringify(audienceSnapshot),
            destinationPath,
            recipientCount: candidates.length,
            createdBy: req.user!.phone,
          },
          type: QueryTypes.SELECT,
        },
      );
      return res.status(201).json(shapeCampaign(rows[0]));
    } catch (error) {
      console.error('[Engagement] create draft error:', error);
      return res.status(500).json({ error: 'Could not save this campaign draft.' });
    }
  },

  updateCampaign: async (req: Request, res: Response) => {
    const vendorId = vendorIdFor(req);
    const campaignId = Number(req.params.campaignId);
    const channel = req.body?.channel === 'push' ? 'push' : 'whatsapp';
    const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 120) : '';
    const message = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 1200) : '';
    const templateKey = typeof req.body?.templateKey === 'string' ? req.body.templateKey.trim().slice(0, 100) : null;
    const audienceFilter = parseAudienceFilter(req.body?.audienceFilter);
    const destinationPath = safeDestinationPath(req.body?.destinationPath);
    if (!vendorId || !campaignId || !title || !message) return res.status(400).json({ error: 'Campaign details are incomplete.' });
    try {
      const [candidates, audienceLabel] = await Promise.all([
        loadAudienceCandidates(vendorId, channel, audienceFilter), audienceLabelFor(vendorId, audienceFilter),
      ]);
      const rows = await sequelize.query<CampaignRow>(
        `UPDATE engagement_campaign SET channel=:channel, title=:title, message=:message,
                template_key=:templateKey, audience_filter=CAST(:audienceFilter AS jsonb),
                audience_label=:audienceLabel, audience_snapshot=CAST(:audienceSnapshot AS jsonb),
                destination_path=:destinationPath, recipient_count=:recipientCount, updated_at=NOW()
          WHERE id=:campaignId AND vendor_id=:vendorId AND status IN ('draft','failed')
          RETURNING id, vendor_id, channel, title, message, template_key, status, recipient_count,
                    audience_filter, audience_label, destination_path, send_count, last_sent_at, created_at, updated_at`,
        { replacements: { campaignId, vendorId, channel, title, message, templateKey,
            audienceFilter: JSON.stringify(audienceFilter), audienceLabel,
            audienceSnapshot: JSON.stringify(snapshotCandidates(candidates, audienceLabel)), destinationPath,
            recipientCount: candidates.length }, type: QueryTypes.SELECT },
      );
      if (!rows.length) return res.status(409).json({ error: 'Only draft or failed campaigns can be edited.' });
      return res.json(shapeCampaign(rows[0]));
    } catch (error) {
      console.error('[Engagement] update campaign error:', error);
      return res.status(500).json({ error: 'Could not update this campaign.' });
    }
  },

  campaignRecipients: async (req: Request, res: Response) => {
    const vendorId = vendorIdFor(req);
    const campaignId = Number(req.params.campaignId);
    if (!vendorId || !Number.isFinite(campaignId) || campaignId <= 0) {
      return res.status(400).json({ error: 'A valid vendor and campaign are required.' });
    }
    try {
      const rows = await sequelize.query<CampaignRow>(
        `SELECT id, vendor_id, channel, title, message, template_key, status, recipient_count,
                audience_filter, audience_label, audience_snapshot, destination_path,
                send_count, last_sent_at, created_at, updated_at
           FROM engagement_campaign
          WHERE id = :campaignId AND vendor_id = :vendorId LIMIT 1`,
        { replacements: { campaignId, vendorId }, type: QueryTypes.SELECT },
      );
      const campaign = rows[0];
      if (!campaign) return res.status(404).json({ error: 'Campaign not found.' });
      let recipients = Array.isArray(campaign.audience_snapshot) ? campaign.audience_snapshot : [];
      if (!recipients.length) {
        const candidates = await loadAudienceCandidates(
          vendorId,
          campaign.channel === 'push' ? 'push' : 'whatsapp',
          parseAudienceFilter(campaign.audience_filter),
        );
        recipients = snapshotCandidates(candidates, campaign.audience_label || 'Saved campaign audience');
      }
      const knownPhones = await sequelize.query<{ phone: string }>(
        `SELECT phone FROM user_communication_preference
         UNION SELECT phone FROM push_subscription
         UNION SELECT delivery.phone FROM engagement_delivery delivery
               JOIN engagement_campaign source_campaign ON source_campaign.id = delivery.campaign_id
              WHERE source_campaign.vendor_id = :vendorId`,
        { replacements: { vendorId }, type: QueryTypes.SELECT },
      );
      const phoneByKey = new Map(knownPhones.map(row => [audienceKey(row.phone), row.phone]));
      const deliveries = await sequelize.query<{ phone: string; status: string; attempted_at: string; error_message: string | null }>(
        `SELECT phone,
                CASE WHEN BOOL_OR(status = 'sent') THEN 'sent' ELSE 'failed' END AS status,
                MAX(attempted_at) AS attempted_at,
                MAX(error_message) FILTER (WHERE error_message IS NOT NULL) AS error_message
           FROM engagement_delivery WHERE campaign_id = :campaignId GROUP BY phone`,
        { replacements: { campaignId }, type: QueryTypes.SELECT },
      );
      const deliveryByKey = new Map(deliveries.map(delivery => [audienceKey(delivery.phone), delivery]));
      return res.json({
        campaignId, audienceLabel: campaign.audience_label || 'Saved campaign audience',
        destinationPath: campaign.destination_path || '/home/history',
        recipients: recipients.map(recipient => {
          const delivery = deliveryByKey.get(recipient.key);
          return {
            ...recipient,
            phone: recipient.phone || phoneByKey.get(recipient.key) || recipient.maskedPhone,
            deliveryStatus: delivery?.status || (campaign.status === 'processing' ? 'sending' : 'not_sent'),
            attemptedAt: delivery?.attempted_at || null,
            deliveryError: delivery?.error_message || null,
          };
        }),
      });
    } catch (error) {
      console.error('[Engagement] campaign recipients error:', error);
      return res.status(500).json({ error: 'Could not load this campaign audience.' });
    }
  },

  sendCampaign: async (req: Request, res: Response) => {
    const vendorId = vendorIdFor(req);
    const campaignId = Number(req.params.campaignId);
    if (!vendorId || !Number.isFinite(campaignId) || campaignId <= 0) {
      return res.status(400).json({ error: 'A valid vendor and campaign are required.' });
    }
    try {
      const campaigns = await sequelize.query<SendCampaignRow>(
        `SELECT ec.id, ec.vendor_id, ec.channel, ec.title, ec.message, ec.template_key,
                ec.status, ec.recipient_count, ec.audience_filter, ec.audience_label,
                ec.audience_snapshot, ec.destination_path, ec.send_count, ec.last_sent_at, ec.created_at, ec.updated_at,
                COALESCE(v.display_name, v.name) AS vendor_name
           FROM engagement_campaign ec
           JOIN vendor v ON v.id = ec.vendor_id
          WHERE ec.id = :campaignId AND ec.vendor_id = :vendorId
          LIMIT 1`,
        { replacements: { campaignId, vendorId }, type: QueryTypes.SELECT },
      );
      const campaign = campaigns[0];
      if (!campaign) return res.status(404).json({ error: 'Campaign not found.' });
      if (campaign.status === 'processing') {
        return res.status(409).json({ error: 'This campaign is already being processed.' });
      }
      if (campaign.channel === 'whatsapp' && !whatsappConfigured()) {
        return res.status(503).json({ error: 'WhatsApp delivery is not configured yet.' });
      }
      if (campaign.channel === 'push' && !pushConfigured()) {
        return res.status(503).json({ error: 'Push delivery is not configured yet.' });
      }

      const claimed = await sequelize.query<{ id: string }>(
        `UPDATE engagement_campaign SET status = 'processing', updated_at = NOW()
          WHERE id = :campaignId AND vendor_id = :vendorId AND status <> 'processing'
          RETURNING id`,
        { replacements: { campaignId, vendorId }, type: QueryTypes.SELECT },
      );
      if (!claimed.length) return res.status(409).json({ error: 'Campaign is already being processed.' });

      const audienceFilter = parseAudienceFilter(campaign.audience_filter);
      const snapshotKeys = Array.isArray(campaign.audience_snapshot)
        ? campaign.audience_snapshot.map(recipient => recipient.key).filter(Boolean)
        : [];
      const sendFilter: AudienceFilter = snapshotKeys.length
        ? { mode: 'custom', value: null, recipientKeys: snapshotKeys }
        : audienceFilter;
      const audienceCandidates = await loadAudienceCandidates(
        vendorId,
        campaign.channel === 'push' ? 'push' : 'whatsapp',
        sendFilter,
      );
      const audiencePhones = audienceCandidates.map(candidate => candidate.phone);
      const recipients = !audiencePhones.length
        ? []
        : campaign.channel === 'whatsapp'
        ? await sequelize.query<{ phone: string; subscription: null; target_key: string }>(
            `SELECT preference.phone, NULL::jsonb AS subscription, preference.phone AS target_key
               FROM user_communication_preference preference
              WHERE preference.channel = 'whatsapp' AND preference.status = 'granted'
                AND preference.phone IN (:audiencePhones)`,
            { replacements: { audiencePhones }, type: QueryTypes.SELECT },
          )
        : await sequelize.query<{ phone: string; subscription: any; target_key: string }>(
            `SELECT ps.phone, ps.subscription, ps.endpoint AS target_key
               FROM push_subscription ps
              WHERE ps.active = true AND ps.phone IN (:audiencePhones)
              ORDER BY ps.phone, ps.updated_at DESC`,
            { replacements: { audiencePhones }, type: QueryTypes.SELECT },
          );

      const message = {
        id: campaignId, title: campaign.title, message: campaign.message,
        templateKey: campaign.template_key, vendorName: campaign.vendor_name,
        destinationPath: campaign.destination_path || '/home/history',
      };
      let delivered = 0;
      let failed = 0;
      for (const recipient of recipients) {
        const result = campaign.channel === 'whatsapp'
          ? await sendWhatsApp(recipient.phone, message)
          : await sendPush(recipient.subscription, message);
        if (result.ok) delivered++; else failed++;
        if (campaign.channel === 'push' && result.subscriptionExpired) {
          await sequelize.query(
            `UPDATE push_subscription SET active = false, updated_at = NOW() WHERE endpoint = :endpoint`,
            { replacements: { endpoint: recipient.target_key } },
          );
        }
        await sequelize.query(
          `INSERT INTO engagement_delivery
             (campaign_id, phone, target_key, channel, status, provider_message_id, error_message, attempted_at, delivered_at)
           VALUES
             (:campaignId, :phone, :targetKey, :channel, :status, :providerMessageId, :errorMessage, NOW(),
              CASE WHEN :status = 'sent' THEN NOW() ELSE NULL END)
           ON CONFLICT (campaign_id, target_key) DO UPDATE SET
             status = EXCLUDED.status, provider_message_id = EXCLUDED.provider_message_id,
             error_message = EXCLUDED.error_message, attempted_at = NOW(),
             delivered_at = EXCLUDED.delivered_at`,
          { replacements: {
            campaignId, phone: recipient.phone, targetKey: recipient.target_key, channel: campaign.channel,
            status: result.ok ? 'sent' : 'failed',
            providerMessageId: result.providerMessageId ?? null,
            errorMessage: result.error?.slice(0, 500) ?? null,
          } },
        );
      }
      const status = !recipients.length ? 'failed' : failed === 0 ? 'sent' : delivered > 0 ? 'partial' : 'failed';
      const uniqueRecipients = new Set(recipients.map(recipient => recipient.phone)).size;
      await sequelize.query(
        `UPDATE engagement_campaign
            SET status = :status, recipient_count = :recipientCount,
                sent_at = CASE WHEN :delivered > 0 THEN COALESCE(sent_at, NOW()) ELSE sent_at END,
                last_sent_at = NOW(), send_count = send_count + 1, updated_at = NOW()
          WHERE id = :campaignId`,
        { replacements: { status, recipientCount: uniqueRecipients, delivered, campaignId } },
      );
      return res.json({ campaignId, status, recipients: uniqueRecipients, attempts: recipients.length, delivered, failed });
    } catch (error) {
      await sequelize.query(
        `UPDATE engagement_campaign SET status = 'failed', updated_at = NOW() WHERE id = :campaignId AND status = 'processing'`,
        { replacements: { campaignId } },
      ).catch(() => {});
      console.error('[Engagement] send error:', error);
      return res.status(500).json({ error: 'Campaign delivery failed.' });
    }
  },
};
