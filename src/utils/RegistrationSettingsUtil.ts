/**
 * Per-event registration settings (Peshkash 5.0). Every option defaults to off, so an event
 * whose vendor never opens the Registration section behaves exactly like one-tap registration.
 */

export type RegistrationMode = 'tap' | 'form';
export type FeedbackWhen = 'manual' | 'after' | 'at';
export type FeedbackChannel = 'manual' | 'whatsapp' | 'push';

export interface PassTemplateRef { kind: 'library' | 'design'; id: string }

export interface RegistrationSettings {
  mode: RegistrationMode;
  capacity: number | null;
  waitlist: { enabled: boolean; autoPromote: boolean; limit: number | null; guestCanLeave: boolean };
  guestCanCancel: boolean;
  approval: boolean;
  inviteOnly: boolean;
  pass: {
    enabled: boolean;
    template: PassTemplateRef;
    visibility: 'owner' | 'link';
    staffPhones: string[];
  };
  confirmationMessage: string;
  addToCalendar: boolean;
  feedback: {
    enabled: boolean;
    when: FeedbackWhen;
    afterMinutes: number;
    at: string | null;
    channel: FeedbackChannel;
    audience: 'checked_in' | 'all';
    showOnPage: boolean;
    thankYou: string;
  };
}

export const DEFAULT_PASS_TEMPLATE: PassTemplateRef = { kind: 'library', id: 'pass-mobile' };
export const LIBRARY_PASS_TEMPLATES = ['pass-mobile', 'pass-stub', 'pass-festive', 'pass-badge', 'pass-rsvp'];

export function defaultRegistrationSettings(): RegistrationSettings {
  return {
    mode: 'tap',
    capacity: null,
    waitlist: { enabled: false, autoPromote: true, limit: null, guestCanLeave: true },
    guestCanCancel: false,
    approval: false,
    inviteOnly: false,
    pass: { enabled: false, template: { ...DEFAULT_PASS_TEMPLATE }, visibility: 'owner', staffPhones: [] },
    confirmationMessage: '',
    addToCalendar: false,
    feedback: { enabled: false, when: 'manual', afterMinutes: 60, at: null, channel: 'manual', audience: 'checked_in', showOnPage: true, thankYou: '' },
  };
}

/** Same normalisation as AuthController: 10 digits → +91, 91XXXXXXXXXX → +91…, other ≥8 digits → +… */
export function normalisePhone(raw: unknown): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (digits.length > 7 && digits.length <= 15) return `+${digits}`;
  return null;
}

const positiveInt = (value: unknown, max: number): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : null;
};
const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
const text = (value: unknown, max: number) => String(value ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);

export function cleanRegistrationSettings(raw: any): RegistrationSettings {
  const d = defaultRegistrationSettings();
  const r = raw && typeof raw === 'object' ? raw : {};
  const templateRaw = r.pass?.template ?? {};
  const template: PassTemplateRef = templateRaw.kind === 'design' && /^\d{1,12}$/.test(String(templateRaw.id ?? ''))
    ? { kind: 'design', id: String(templateRaw.id) }
    : { kind: 'library', id: LIBRARY_PASS_TEMPLATES.includes(templateRaw.id) ? templateRaw.id : DEFAULT_PASS_TEMPLATE.id };
  const staffPhones = [...new Set((Array.isArray(r.pass?.staffPhones) ? r.pass.staffPhones : [])
    .map(normalisePhone).filter(Boolean) as string[])].slice(0, 20);
  const at = typeof r.feedback?.at === 'string' && !Number.isNaN(Date.parse(r.feedback.at)) ? new Date(r.feedback.at).toISOString() : null;
  const when: FeedbackWhen = ['manual', 'after', 'at'].includes(r.feedback?.when) ? r.feedback.when : d.feedback.when;
  return {
    mode: r.mode === 'form' ? 'form' : 'tap',
    capacity: positiveInt(r.capacity, 100000),
    waitlist: {
      enabled: bool(r.waitlist?.enabled, d.waitlist.enabled),
      autoPromote: bool(r.waitlist?.autoPromote, d.waitlist.autoPromote),
      limit: positiveInt(r.waitlist?.limit, 100000),
      guestCanLeave: bool(r.waitlist?.guestCanLeave, d.waitlist.guestCanLeave),
    },
    guestCanCancel: bool(r.guestCanCancel, d.guestCanCancel),
    approval: bool(r.approval, d.approval),
    inviteOnly: bool(r.inviteOnly, d.inviteOnly),
    pass: {
      enabled: bool(r.pass?.enabled, d.pass.enabled),
      template,
      visibility: r.pass?.visibility === 'link' ? 'link' : 'owner',
      staffPhones,
    },
    confirmationMessage: text(r.confirmationMessage, 1000),
    addToCalendar: bool(r.addToCalendar, d.addToCalendar),
    feedback: {
      enabled: bool(r.feedback?.enabled, d.feedback.enabled),
      when: when === 'at' && !at ? 'manual' : when,
      afterMinutes: Math.max(0, Math.min(60 * 24 * 14, Math.floor(Number(r.feedback?.afterMinutes ?? d.feedback.afterMinutes)) || 0)),
      at,
      channel: ['manual', 'whatsapp', 'push'].includes(r.feedback?.channel) ? r.feedback.channel : d.feedback.channel,
      audience: r.feedback?.audience === 'all' ? 'all' : 'checked_in',
      showOnPage: bool(r.feedback?.showOnPage, d.feedback.showOnPage),
      thankYou: text(r.feedback?.thankYou, 500),
    },
  };
}

/** When a scheduled feedback request becomes due, or null when it is manual / not scheduled. */
export function feedbackDueAt(settings: RegistrationSettings, eventEnd: Date | null | undefined): Date | null {
  if (!settings.feedback.enabled) return null;
  if (settings.feedback.when === 'at') return settings.feedback.at ? new Date(settings.feedback.at) : null;
  if (settings.feedback.when === 'after' && eventEnd) return new Date(new Date(eventEnd).getTime() + settings.feedback.afterMinutes * 60_000);
  return null;
}

/** Door staff keep access until a day after the event ends (two days after start if no end). */
export function staffAccessOpen(eventStart: Date | null | undefined, eventEnd: Date | null | undefined, now = Date.now()): boolean {
  const reference = eventEnd ? new Date(eventEnd).getTime() : eventStart ? new Date(eventStart).getTime() + 86_400_000 : null;
  return reference === null || now <= reference + 86_400_000;
}
