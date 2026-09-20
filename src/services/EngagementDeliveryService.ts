import webpush, { PushSubscription } from 'web-push';

export type CampaignMessage = {
  id: number;
  title: string;
  message: string;
  templateKey: string | null;
  vendorName: string;
};

export type DeliveryResult = { ok: boolean; providerMessageId?: string; error?: string; subscriptionExpired?: boolean };

function normaliseWhatsAppPhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

function whatsappTemplateName(key: string | null): string | null {
  if (!key) return null;
  try {
    const configured = JSON.parse(process.env.WHATSAPP_TEMPLATE_MAP_JSON || '{}');
    return typeof configured[key] === 'string' ? configured[key] : null;
  } catch {
    return null;
  }
}

export function whatsappConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

export function pushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export async function sendWhatsApp(phone: string, campaign: CampaignMessage): Promise<DeliveryResult> {
  if (!whatsappConfigured()) return { ok: false, error: 'WhatsApp provider is not configured.' };
  const templateName = whatsappTemplateName(campaign.templateKey);
  if (!templateName) return { ok: false, error: `No approved WhatsApp template is mapped for ${campaign.templateKey || 'this campaign'}.` };
  try {
    const response = await fetch(
      `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION || 'v23.0'}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: normaliseWhatsAppPhone(phone),
          type: 'template',
          template: {
            name: templateName,
            language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en' },
            components: [{
              type: 'body',
              parameters: [
                { type: 'text', text: campaign.vendorName },
                { type: 'text', text: campaign.message },
              ],
            }],
          },
        }),
      },
    );
    const data: any = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, error: data?.error?.message || `WhatsApp returned ${response.status}.` };
    return { ok: true, providerMessageId: data?.messages?.[0]?.id };
  } catch (error: any) {
    return { ok: false, error: error?.message || 'WhatsApp request failed.' };
  }
}

function configureWebPush() {
  if (!pushConfigured()) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:hello@peshkash.app',
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  return true;
}

export async function sendPush(subscription: PushSubscription, campaign: CampaignMessage): Promise<DeliveryResult> {
  if (!configureWebPush()) return { ok: false, error: 'Push provider is not configured.' };
  try {
    await webpush.sendNotification(subscription, JSON.stringify({
      title: campaign.title,
      body: campaign.message,
      icon: '/android-chrome-192x192.png',
      badge: '/favicon-32x32.png',
      url: '/home/history',
      tag: `peshkash-campaign-${campaign.id}`,
    }), { TTL: 86_400, urgency: 'normal' });
    return { ok: true };
  } catch (error: any) {
    const statusCode = Number(error?.statusCode || 0);
    return {
      ok: false,
      error: error?.body || error?.message || 'Push request failed.',
      subscriptionExpired: statusCode === 404 || statusCode === 410,
    };
  }
}
