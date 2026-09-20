import { Request, Response } from 'express';
import { QueryTypes } from 'sequelize';
import { sequelize } from '../config/sequelize';
import { pushConfigured, sendPush, sendWhatsApp, whatsappConfigured } from '../services/EngagementDeliveryService';

type CampaignRow = {
  id: string; vendor_id: string; channel: string; title: string; message: string;
  template_key: string | null; status: string; recipient_count: number;
  created_at: string; updated_at: string;
};

type SendCampaignRow = CampaignRow & { vendor_name: string };

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
                  recipient_count, created_at, updated_at
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

  createDraft: async (req: Request, res: Response) => {
    const vendorId = vendorIdFor(req);
    const channel = req.body?.channel === 'push' ? 'push' : 'whatsapp';
    const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 120) : '';
    const message = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 1200) : '';
    const templateKey = typeof req.body?.templateKey === 'string' ? req.body.templateKey.trim().slice(0, 100) : null;
    if (!vendorId) return res.status(400).json({ error: 'Select a vendor first.' });
    if (!title || !message) return res.status(400).json({ error: 'Campaign title and message are required.' });
    try {
      const counts = await sequelize.query<{ total: string }>(
        `SELECT COUNT(DISTINCT preference.phone) AS total
           FROM user_communication_preference preference
          WHERE preference.channel = :channel AND preference.status = 'granted'
            AND EXISTS (
              SELECT 1 FROM analytics_event ae
              LEFT JOIN device_link dl ON dl.device_id = ae.device_id
              WHERE COALESCE(dl.phone, ae.phone) = preference.phone
                AND ae.vendor_id = :vendorId
            )`,
        { replacements: { vendorId, channel }, type: QueryTypes.SELECT },
      );
      const rows = await sequelize.query<CampaignRow>(
        `INSERT INTO engagement_campaign
           (vendor_id, channel, title, message, template_key, status, audience_filter,
            recipient_count, created_by, created_at, updated_at)
         VALUES
           (:vendorId, :channel, :title, :message, :templateKey, 'draft',
            CAST(:audienceFilter AS jsonb), :recipientCount, :createdBy, NOW(), NOW())
         RETURNING id, vendor_id, channel, title, message, template_key, status,
                   recipient_count, created_at, updated_at`,
        {
          replacements: {
            vendorId, channel, title, message, templateKey,
            audienceFilter: JSON.stringify({ consent: 'granted', channel }),
            recipientCount: Number(counts[0]?.total ?? 0),
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

  sendCampaign: async (req: Request, res: Response) => {
    const vendorId = vendorIdFor(req);
    const campaignId = Number(req.params.campaignId);
    if (!vendorId || !Number.isFinite(campaignId) || campaignId <= 0) {
      return res.status(400).json({ error: 'A valid vendor and campaign are required.' });
    }
    try {
      const campaigns = await sequelize.query<SendCampaignRow>(
        `SELECT ec.id, ec.vendor_id, ec.channel, ec.title, ec.message, ec.template_key,
                ec.status, ec.recipient_count, ec.created_at, ec.updated_at,
                COALESCE(v.display_name, v.name) AS vendor_name
           FROM engagement_campaign ec
           JOIN vendor v ON v.id = ec.vendor_id
          WHERE ec.id = :campaignId AND ec.vendor_id = :vendorId
          LIMIT 1`,
        { replacements: { campaignId, vendorId }, type: QueryTypes.SELECT },
      );
      const campaign = campaigns[0];
      if (!campaign) return res.status(404).json({ error: 'Campaign not found.' });
      if (campaign.status !== 'draft' && campaign.status !== 'failed') {
        return res.status(409).json({ error: `This campaign is already ${campaign.status}.` });
      }
      if (campaign.channel === 'whatsapp' && !whatsappConfigured()) {
        return res.status(503).json({ error: 'WhatsApp delivery is not configured yet.' });
      }
      if (campaign.channel === 'push' && !pushConfigured()) {
        return res.status(503).json({ error: 'Push delivery is not configured yet.' });
      }

      const claimed = await sequelize.query<{ id: string }>(
        `UPDATE engagement_campaign SET status = 'processing', updated_at = NOW()
          WHERE id = :campaignId AND vendor_id = :vendorId AND status IN ('draft','failed')
          RETURNING id`,
        { replacements: { campaignId, vendorId }, type: QueryTypes.SELECT },
      );
      if (!claimed.length) return res.status(409).json({ error: 'Campaign is already being processed.' });

      const recipients = campaign.channel === 'whatsapp'
        ? await sequelize.query<{ phone: string; subscription: null; target_key: string }>(
            `SELECT preference.phone, NULL::jsonb AS subscription, preference.phone AS target_key
               FROM user_communication_preference preference
              WHERE preference.channel = 'whatsapp' AND preference.status = 'granted'
                AND EXISTS (
                  SELECT 1 FROM analytics_event ae
                  LEFT JOIN device_link dl ON dl.device_id = ae.device_id
                  WHERE COALESCE(dl.phone, ae.phone) = preference.phone
                    AND ae.vendor_id = :vendorId
                )`,
            { replacements: { vendorId }, type: QueryTypes.SELECT },
          )
        : await sequelize.query<{ phone: string; subscription: any; target_key: string }>(
            `SELECT ps.phone, ps.subscription, ps.endpoint AS target_key
               FROM user_communication_preference preference
               JOIN push_subscription ps ON ps.phone = preference.phone AND ps.active = true
              WHERE preference.channel = 'push' AND preference.status = 'granted'
                AND EXISTS (
                  SELECT 1 FROM analytics_event ae
                  LEFT JOIN device_link dl ON dl.device_id = ae.device_id
                  WHERE COALESCE(dl.phone, ae.phone) = preference.phone
                    AND ae.vendor_id = :vendorId
                )
              ORDER BY ps.phone, ps.updated_at DESC`,
            { replacements: { vendorId }, type: QueryTypes.SELECT },
          );

      const message = {
        id: campaignId, title: campaign.title, message: campaign.message,
        templateKey: campaign.template_key, vendorName: campaign.vendor_name,
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
                sent_at = CASE WHEN :delivered > 0 THEN NOW() ELSE sent_at END, updated_at = NOW()
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
