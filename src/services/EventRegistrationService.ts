import { QueryTypes, Transaction } from 'sequelize';
import { sequelize } from '../config/sequelize';
import type { AuthPayload } from './AuthService';
import {
  applyFormUpdate, cleanForm, emptyForm, EventForm, FormKind, passAnswers, publicQuestions, validateAnswers,
} from '../utils/RegistrationFormUtil';
import {
  cleanRegistrationSettings, defaultRegistrationSettings, feedbackDueAt, normalisePhone, RegistrationSettings, staffAccessOpen,
} from '../utils/RegistrationSettingsUtil';
import { deriveToken, extractToken, hashToken, newNonce, passCode } from '../utils/PassTokenUtil';
import { pushConfigured, sendPush, sendWhatsApp, whatsappConfigured } from './EngagementDeliveryService';

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) { super(message); }
}

export type RegistrationStatus = 'registered' | 'pending' | 'waitlisted' | 'cancelled';

export interface EventContext {
  id: number;
  name: string;
  displayName: string;
  startTime: Date | null;
  endTime: Date | null;
  status: string;
  experience: Record<string, any>;
  vendorId: number;
  vendor: { id: number; name: string; displayName: string; logoUrl: string | null };
}

interface RegistrationRow {
  id: number;
  event_id: number;
  phone: string;
  status: RegistrationStatus;
  party_size: number;
  answers: Record<string, any>;
  form_version: number | null;
  guest_name: string | null;
  waitlist_rank: number | null;
  pass_nonce: string | null;
  pass_token_hash: string | null;
  pass_code: string | null;
  checked_in_at: Date | null;
  checked_in_by: string | null;
  check_in_method: string | null;
  cancelled_at: Date | null;
  cancelled_by: string | null;
  registered_at: Date;
  updated_at: Date;
  source: string;
}

const q = <T extends object>(sql: string, replacements: Record<string, unknown> = {}, transaction?: Transaction) =>
  sequelize.query<T>(sql, { replacements, type: QueryTypes.SELECT, transaction });
const exec = (sql: string, replacements: Record<string, unknown> = {}, transaction?: Transaction) =>
  sequelize.query(sql, { replacements, transaction });

const EVENT_SELECT = `
  SELECT e.id, e.name, e.display_name AS "displayName", e.start_time AS "startTime", e.end_time AS "endTime",
         e.status, e.experience_config AS experience, e.vendor_id AS "vendorId",
         v.name AS "vendorName", v.display_name AS "vendorDisplayName", v.logo_url AS "vendorLogoUrl"
    FROM event e LEFT JOIN vendor v ON v.id = e.vendor_id`;

function toContext(row: any): EventContext {
  return {
    id: Number(row.id), name: row.name, displayName: row.displayName || row.name,
    startTime: row.startTime ? new Date(row.startTime) : null, endTime: row.endTime ? new Date(row.endTime) : null,
    status: row.status, experience: row.experience ?? {}, vendorId: Number(row.vendorId),
    vendor: { id: Number(row.vendorId), name: row.vendorName ?? '', displayName: row.vendorDisplayName || row.vendorName || '', logoUrl: row.vendorLogoUrl ?? null },
  };
}

export function canManageEvent(user: AuthPayload | null | undefined, event: { vendorId: number }): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const ids = user.vendorIds ?? (user.vendorId ? [Number(user.vendorId)] : []);
  return user.role === 'vendor' && ids.includes(Number(event.vendorId));
}

function firstLast(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] ?? '', last: parts.slice(1).join(' ') };
}

function maskPhone(phone: string) {
  const digits = phone.replace(/\D/g, '');
  return `•••• ${digits.slice(-4)}`;
}

export const EventRegistrationService = {
  // ── Loading ───────────────────────────────────────────────────────────────
  async eventByName(name: string): Promise<EventContext> {
    const rows = await q<any>(`${EVENT_SELECT} WHERE e.name = :name LIMIT 1`, { name });
    if (!rows.length) throw new HttpError(404, 'Event not found');
    return toContext(rows[0]);
  },

  async eventById(id: number): Promise<EventContext> {
    const rows = await q<any>(`${EVENT_SELECT} WHERE e.id = :id LIMIT 1`, { id });
    if (!rows.length) throw new HttpError(404, 'Event not found');
    return toContext(rows[0]);
  },

  async settings(eventId: number, transaction?: Transaction): Promise<{ settings: RegistrationSettings; configured: boolean }> {
    const rows = await q<{ settings: unknown }>(`SELECT settings FROM event_registration_settings WHERE event_id = :eventId`, { eventId }, transaction);
    return rows.length
      ? { settings: cleanRegistrationSettings(rows[0].settings), configured: true }
      : { settings: defaultRegistrationSettings(), configured: false };
  },

  async saveSettings(eventId: number, raw: unknown, actor: string): Promise<RegistrationSettings> {
    const settings = cleanRegistrationSettings(raw);
    await exec(`
      INSERT INTO event_registration_settings (event_id, settings, updated_by, updated_at)
      VALUES (:eventId, CAST(:settings AS JSONB), :actor, NOW())
      ON CONFLICT (event_id) DO UPDATE SET settings = EXCLUDED.settings, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    { eventId, settings: JSON.stringify(settings), actor });
    return settings;
  },

  /** Marks the event as managed by the 5.0 flow without changing any option. */
  async ensureConfigured(eventId: number, actor: string) {
    await exec(`
      INSERT INTO event_registration_settings (event_id, settings, updated_by)
      VALUES (:eventId, CAST(:settings AS JSONB), :actor) ON CONFLICT (event_id) DO NOTHING`,
    { eventId, settings: JSON.stringify(defaultRegistrationSettings()), actor });
  },

  async form(eventId: number, kind: FormKind, transaction?: Transaction): Promise<EventForm> {
    const rows = await q<any>(`SELECT title, description, questions, version FROM event_form WHERE event_id = :eventId AND kind = :kind`, { eventId, kind }, transaction);
    if (!rows.length) return emptyForm();
    // Stored forms were cleaned on save; re-clean defensively but keep stored timestamps.
    return cleanForm(rows[0]);
  },

  async responseCount(eventId: number, kind: FormKind): Promise<number> {
    const rows = kind === 'registration'
      ? await q<{ n: string }>(`SELECT COUNT(*) AS n FROM event_registration WHERE event_id = :eventId AND form_version IS NOT NULL`, { eventId })
      : await q<{ n: string }>(`SELECT COUNT(*) AS n FROM event_feedback WHERE event_id = :eventId`, { eventId });
    return Number(rows[0]?.n ?? 0);
  },

  async saveForm(eventId: number, kind: FormKind, raw: unknown, actor: string) {
    const saved = await this.form(eventId, kind);
    const responses = await this.responseCount(eventId, kind);
    const next = applyFormUpdate(saved, raw, responses > 0);
    await exec(`
      INSERT INTO event_form (event_id, kind, title, description, questions, version, updated_at)
      VALUES (:eventId, :kind, :title, :description, CAST(:questions AS JSONB), :version, NOW())
      ON CONFLICT (event_id, kind) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description,
        questions = EXCLUDED.questions, version = EXCLUDED.version, updated_at = NOW()`,
    { eventId, kind, title: next.title, description: next.description, questions: JSON.stringify(next.questions), version: next.version });
    await this.ensureConfigured(eventId, actor);
    return { form: next, responses, locked: responses > 0 };
  },

  // ── Seats, waitlist, passes ───────────────────────────────────────────────
  async seatsTaken(eventId: number, transaction?: Transaction): Promise<number> {
    const rows = await q<{ n: string | null }>(
      `SELECT COALESCE(SUM(party_size), 0) AS n FROM event_registration WHERE event_id = :eventId AND status IN ('registered','pending')`,
      { eventId }, transaction);
    return Number(rows[0]?.n ?? 0);
  },

  async waitlistCount(eventId: number, transaction?: Transaction): Promise<number> {
    const rows = await q<{ n: string }>(`SELECT COUNT(*) AS n FROM event_registration WHERE event_id = :eventId AND status = 'waitlisted'`, { eventId }, transaction);
    return Number(rows[0]?.n ?? 0);
  },

  async waitlistPosition(row: RegistrationRow, transaction?: Transaction): Promise<number | null> {
    if (row.status !== 'waitlisted') return null;
    const rows = await q<{ n: string }>(
      `SELECT COUNT(*) AS n FROM event_registration WHERE event_id = :eventId AND status = 'waitlisted' AND waitlist_rank <= :rank`,
      { eventId: row.event_id, rank: row.waitlist_rank ?? 0 }, transaction);
    return Number(rows[0]?.n ?? 1);
  },

  async nextWaitlistRank(eventId: number, transaction?: Transaction): Promise<number> {
    const rows = await q<{ r: number | null }>(`SELECT MAX(waitlist_rank) AS r FROM event_registration WHERE event_id = :eventId`, { eventId }, transaction);
    return Math.max(Date.now(), Number(rows[0]?.r ?? 0) + 1);
  },

  passToken(row: Pick<RegistrationRow, 'id' | 'pass_nonce'>): string | null {
    return row.pass_nonce ? deriveToken('pass', row.id, row.pass_nonce) : null;
  },

  /** Issues a pass for a confirmed registration when passes are on. Returns the token. */
  async ensurePass(row: RegistrationRow, event: EventContext, settings: RegistrationSettings, transaction?: Transaction, reissue = false): Promise<string | null> {
    if (!settings.pass.enabled || row.status !== 'registered') return null;
    if (row.pass_nonce && !reissue) return this.passToken(row);
    const nonce = newNonce();
    const token = deriveToken('pass', row.id, nonce);
    const hash = hashToken(token);
    const code = passCode(event.displayName, hash);
    await exec(`UPDATE event_registration SET pass_nonce = :nonce, pass_token_hash = :hash, pass_code = :code, updated_at = NOW() WHERE id = :id`,
      { nonce, hash, code, id: row.id }, transaction);
    Object.assign(row, { pass_nonce: nonce, pass_token_hash: hash, pass_code: code });
    return token;
  },

  async revokePass(rowId: number, transaction?: Transaction) {
    await exec(`UPDATE event_registration SET pass_nonce = NULL, pass_token_hash = NULL WHERE id = :id`, { id: rowId }, transaction);
  },

  /** Moves waitlisted guests in, first come first served, while their party fits. */
  async promoteFromWaitlist(event: EventContext, settings: RegistrationSettings, transaction: Transaction): Promise<RegistrationRow[]> {
    if (!settings.waitlist.enabled || !settings.waitlist.autoPromote) return [];
    const promoted: RegistrationRow[] = [];
    const waiting = await q<RegistrationRow>(
      `SELECT * FROM event_registration WHERE event_id = :eventId AND status = 'waitlisted' ORDER BY waitlist_rank ASC, id ASC`,
      { eventId: event.id }, transaction);
    let taken = await this.seatsTaken(event.id, transaction);
    for (const row of waiting) {
      if (settings.capacity !== null && taken + row.party_size > settings.capacity) continue;
      const status: RegistrationStatus = settings.approval ? 'pending' : 'registered';
      await exec(`UPDATE event_registration SET status = :status, waitlist_rank = NULL, updated_at = NOW() WHERE id = :id`, { status, id: row.id }, transaction);
      row.status = status;
      await this.ensurePass(row, event, settings, transaction);
      taken += row.party_size;
      promoted.push(row);
    }
    return promoted;
  },

  async notify(phones: string[], title: string, message: string, url: string): Promise<{ attempted: number; delivered: number }> {
    if (!phones.length || !pushConfigured()) return { attempted: 0, delivered: 0 };
    const subs = await q<{ phone: string; subscription: any }>(
      `SELECT phone, subscription FROM push_subscription WHERE active = true AND phone IN (:phones)`, { phones });
    let delivered = 0;
    for (const sub of subs) {
      const result = await sendPush(sub.subscription, { id: 0, title, message, templateKey: null, vendorName: '', destinationPath: url });
      if (result.ok) delivered += 1;
      else if (result.subscriptionExpired) await exec(`UPDATE push_subscription SET active = false, updated_at = NOW() WHERE subscription = CAST(:s AS JSONB)`, { s: JSON.stringify(sub.subscription) }).catch(() => {});
    }
    return { attempted: subs.length, delivered };
  },

  async notifyPromoted(event: EventContext, rows: RegistrationRow[]) {
    for (const row of rows) {
      const token = this.passToken(row);
      const url = token ? `/t/${token}` : `/event/${event.name}`;
      const message = row.status === 'pending'
        ? `A seat opened up at ${event.displayName}. ${event.vendor.displayName} will confirm your registration shortly.`
        : `A seat opened up — you're in for ${event.displayName}.`;
      await this.notify([row.phone], event.displayName, message, url).catch(() => undefined);
    }
  },

  // ── Guest side ────────────────────────────────────────────────────────────
  registrationClosedReason(event: EventContext): string | null {
    if (!event.experience?.enabled) return 'Event page not found';
    if (event.status !== 'active') return 'This event is not open for registration';
    if (event.experience.registrationEnabled === false) return 'Registration is not enabled for this event';
    if (event.endTime && Date.now() > event.endTime.getTime()) return 'This event has ended';
    return null;
  },

  async myRow(eventId: number, phone: string, transaction?: Transaction): Promise<RegistrationRow | null> {
    const rows = await q<RegistrationRow>(`SELECT * FROM event_registration WHERE event_id = :eventId AND phone = :phone LIMIT 1`, { eventId, phone }, transaction);
    return rows[0] ?? null;
  },

  async describeMine(row: RegistrationRow | null, event: EventContext, settings: RegistrationSettings) {
    if (!row || row.status === 'cancelled') return row ? { status: 'cancelled' as const } : null;
    const passToken = await this.ensurePass(row, event, settings);
    const feedback = await q<{ submitted_at: Date }>(`SELECT submitted_at FROM event_feedback WHERE event_id = :eventId AND phone = :phone`, { eventId: event.id, phone: row.phone });
    return {
      status: row.status,
      partySize: row.party_size,
      guestName: row.guest_name ?? '',
      answers: row.answers ?? {},
      registeredAt: row.registered_at,
      waitlistPosition: await this.waitlistPosition(row),
      passToken,
      passCode: passToken ? row.pass_code : null,
      checkedInAt: row.checked_in_at,
      feedbackSubmitted: feedback.length > 0,
    };
  },

  async feedbackState(event: EventContext, settings: RegistrationSettings) {
    if (!settings.feedback.enabled) return { open: false };
    const dispatch = await q<{ sent_at: Date }>(`SELECT sent_at FROM event_feedback_dispatch WHERE event_id = :eventId`, { eventId: event.id });
    const ended = Boolean(event.endTime && Date.now() > event.endTime.getTime());
    return { open: dispatch.length > 0 || (settings.feedback.showOnPage && ended), sentAt: dispatch[0]?.sent_at ?? null };
  },

  /** Everything the public event page needs to run the 5.0 flow for the current visitor. */
  async publicContext(eventName: string, user: AuthPayload | null) {
    const event = await this.eventByName(eventName);
    if (!event.experience?.enabled) throw new HttpError(404, 'Event page not found');
    const manager = canManageEvent(user, event);
    if (event.status !== 'active' && !manager) throw new HttpError(404, 'Event page not found');
    const { settings, configured } = await this.settings(event.id);
    const form = await this.form(event.id, 'registration');
    const taken = settings.capacity !== null ? await this.seatsTaken(event.id) : 0;
    const waitlisted = settings.waitlist.enabled ? await this.waitlistCount(event.id) : 0;
    const mine = user?.phone ? await this.describeMine(await this.myRow(event.id, user.phone), event, settings) : null;
    const feedback = await this.feedbackState(event, settings);
    const feedbackForm = feedback.open ? await this.form(event.id, 'feedback') : null;
    return {
      configured,
      eventId: event.id,
      mode: settings.mode,
      closedReason: this.registrationClosedReason(event),
      form: settings.mode === 'form'
        ? { title: form.title, description: form.description, version: form.version, questions: publicQuestions(form) }
        : null,
      seats: settings.capacity !== null ? { capacity: settings.capacity, left: Math.max(0, settings.capacity - taken) } : null,
      waitlist: { enabled: settings.waitlist.enabled, guestCanLeave: settings.waitlist.guestCanLeave, full: settings.waitlist.limit !== null && waitlisted >= settings.waitlist.limit },
      guestCanCancel: settings.guestCanCancel,
      approval: settings.approval,
      inviteOnly: settings.inviteOnly,
      pass: { enabled: settings.pass.enabled, template: settings.pass.template },
      confirmationMessage: settings.confirmationMessage,
      addToCalendar: settings.addToCalendar,
      feedback: {
        open: feedback.open,
        thankYou: settings.feedback.thankYou,
        form: feedbackForm ? { title: feedbackForm.title, description: feedbackForm.description, version: feedbackForm.version, questions: publicQuestions(feedbackForm) } : null,
      },
      me: mine,
    };
  },

  async resolveInvite(event: EventContext, token: string | null, phone: string, transaction: Transaction) {
    if (!token) throw new HttpError(403, 'Registration for this event is by invitation only.');
    const rows = await q<{ id: number; phone: string; revoked_at: Date | null }>(
      `SELECT id, phone, revoked_at FROM event_invite WHERE event_id = :eventId AND token_hash = :hash LIMIT 1`,
      { eventId: event.id, hash: hashToken(token) }, transaction);
    const invite = rows[0];
    if (!invite || invite.revoked_at) throw new HttpError(403, 'This invitation link is not valid.');
    if (invite.phone !== phone) throw new HttpError(403, 'This invitation was sent to a different phone number. Sign in with that number to register.');
    return invite;
  },

  async register(eventName: string, user: AuthPayload, body: any) {
    const phone = user.phone;
    const event = await this.eventByName(eventName);
    const closed = this.registrationClosedReason(event);
    if (closed) throw new HttpError(closed === 'Event page not found' ? 404 : 409, closed);

    return sequelize.transaction(async (transaction) => {
      // One registration at a time per event, so two guests can never take the last seat.
      await exec(`SELECT pg_advisory_xact_lock(:key)`, { key: 5_000_000_000 + event.id }, transaction);
      const { settings } = await this.settings(event.id, transaction);
      const form = await this.form(event.id, 'registration', transaction);
      const existing = await this.myRow(event.id, phone, transaction);
      if (existing && existing.status !== 'cancelled') {
        return { duplicate: true, me: await this.describeMine(existing, event, settings) };
      }

      let inviteId: number | null = null;
      if (settings.inviteOnly) inviteId = (await this.resolveInvite(event, extractToken(body?.invite), phone, transaction)).id;

      let answers: Record<string, any> = {};
      let partySize = 1;
      let guestName = '';
      let formVersion: number | null = null;
      if (settings.mode === 'form') {
        const digits = phone.replace(/\D/g, '');
        const validated = validateAnswers(form, body?.answers, `${event.id}/${digits}/`);
        if (Object.keys(validated.errors).length) throw new HttpError(422, 'Some answers need attention.', validated.errors);
        ({ answers, partySize, guestName } = validated);
        formVersion = form.version;
      }

      let status: RegistrationStatus = settings.approval ? 'pending' : 'registered';
      let waitlistRank: number | null = null;
      if (settings.capacity !== null) {
        const taken = await this.seatsTaken(event.id, transaction);
        if (taken + partySize > settings.capacity) {
          if (!settings.waitlist.enabled) {
            throw new HttpError(409, partySize > 1 && taken < settings.capacity
              ? `Only ${settings.capacity - taken} seat${settings.capacity - taken === 1 ? '' : 's'} left. Try a smaller party.`
              : 'This event is full.');
          }
          if (settings.waitlist.limit !== null && await this.waitlistCount(event.id, transaction) >= settings.waitlist.limit) {
            throw new HttpError(409, 'This event and its waitlist are full.');
          }
          status = 'waitlisted';
          waitlistRank = await this.nextWaitlistRank(event.id, transaction);
        }
      }

      const params = {
        eventId: event.id, phone, status, partySize, answers: JSON.stringify(answers), formVersion, guestName: guestName || null,
        waitlistRank, source: settings.mode === 'form' ? 'form' : 'one_tap_v5', inviteId,
      };
      const rows = await q<RegistrationRow>(`
        INSERT INTO event_registration (event_id, phone, status, party_size, answers, form_version, guest_name, waitlist_rank, source, invite_id, registered_at, updated_at)
        VALUES (:eventId, :phone, :status, :partySize, CAST(:answers AS JSONB), :formVersion, :guestName, :waitlistRank, :source, :inviteId, NOW(), NOW())
        ON CONFLICT (event_id, phone) DO UPDATE SET
          status = EXCLUDED.status, party_size = EXCLUDED.party_size, answers = EXCLUDED.answers, form_version = EXCLUDED.form_version,
          guest_name = EXCLUDED.guest_name, waitlist_rank = EXCLUDED.waitlist_rank, source = EXCLUDED.source, invite_id = EXCLUDED.invite_id,
          cancelled_at = NULL, cancelled_by = NULL, checked_in_at = NULL, checked_in_by = NULL, check_in_method = NULL,
          pass_nonce = NULL, pass_token_hash = NULL, pass_code = NULL, registered_at = NOW(), updated_at = NOW()
        RETURNING *`, params, transaction);
      const row = rows[0];
      if (inviteId) await exec(`UPDATE event_invite SET used_at = COALESCE(used_at, NOW()) WHERE id = :id`, { id: inviteId }, transaction);
      await this.ensurePass(row, event, settings, transaction);
      return { duplicate: false, event, me: await this.describeMineTx(row, event, settings, transaction) };
    });
  },

  /** describeMine for a row inside an open transaction (no extra writes needed). */
  async describeMineTx(row: RegistrationRow, _event: EventContext, _settings: RegistrationSettings, transaction: Transaction) {
    const passToken = this.passToken(row);
    return {
      status: row.status, partySize: row.party_size, guestName: row.guest_name ?? '', answers: row.answers ?? {},
      registeredAt: row.registered_at, waitlistPosition: await this.waitlistPosition(row, transaction),
      passToken, passCode: passToken ? row.pass_code : null, checkedInAt: row.checked_in_at, feedbackSubmitted: false,
    };
  },

  async cancelOwn(eventName: string, user: AuthPayload) {
    const event = await this.eventByName(eventName);
    const promoted = await sequelize.transaction(async (transaction) => {
      await exec(`SELECT pg_advisory_xact_lock(:key)`, { key: 5_000_000_000 + event.id }, transaction);
      const { settings } = await this.settings(event.id, transaction);
      const row = await this.myRow(event.id, user.phone, transaction);
      if (!row || row.status === 'cancelled') throw new HttpError(404, 'You are not registered for this event.');
      if (row.status === 'waitlisted' ? !settings.waitlist.guestCanLeave : !settings.guestCanCancel) {
        throw new HttpError(403, row.status === 'waitlisted' ? 'Leaving the waitlist is turned off for this event.' : 'Cancelling is turned off for this event. Contact the host.');
      }
      if (row.checked_in_at) throw new HttpError(409, 'You have already checked in.');
      await exec(`UPDATE event_registration SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = :phone, waitlist_rank = NULL,
                    pass_nonce = NULL, pass_token_hash = NULL, updated_at = NOW() WHERE id = :id`, { id: row.id, phone: user.phone }, transaction);
      return this.promoteFromWaitlist(event, settings, transaction);
    });
    await this.notifyPromoted(event, promoted);
    return { ok: true, promoted: promoted.length };
  },

  async submitFeedback(eventName: string, user: AuthPayload, body: any) {
    const event = await this.eventByName(eventName);
    const { settings } = await this.settings(event.id);
    const state = await this.feedbackState(event, settings);
    if (!state.open) throw new HttpError(409, 'Feedback is not open for this event.');
    const row = await this.myRow(event.id, user.phone);
    if (!row || row.status !== 'registered') throw new HttpError(403, 'Only registered guests can share feedback.');
    const form = await this.form(event.id, 'feedback');
    const validated = validateAnswers(form, body?.answers, `${event.id}/${user.phone.replace(/\D/g, '')}/`);
    if (Object.keys(validated.errors).length) throw new HttpError(422, 'Some answers need attention.', validated.errors);
    await exec(`
      INSERT INTO event_feedback (event_id, phone, registration_id, answers, form_version)
      VALUES (:eventId, :phone, :rid, CAST(:answers AS JSONB), :version)
      ON CONFLICT (event_id, phone) DO UPDATE SET answers = EXCLUDED.answers, form_version = EXCLUDED.form_version, submitted_at = NOW()`,
    { eventId: event.id, phone: user.phone, rid: row.id, answers: JSON.stringify(validated.answers), version: form.version });
    return { ok: true, thankYou: settings.feedback.thankYou };
  },

  // ── Passes ────────────────────────────────────────────────────────────────
  async pass(token: string, user: AuthPayload | null) {
    const clean = extractToken(token);
    const notFound = new HttpError(404, 'Pass not found');
    if (!clean) throw notFound;
    const rows = await q<RegistrationRow>(`SELECT * FROM event_registration WHERE pass_token_hash = :hash LIMIT 1`, { hash: hashToken(clean) });
    const row = rows[0];
    if (!row || row.status !== 'registered') throw notFound;
    const event = await this.eventById(row.event_id);
    const { settings } = await this.settings(event.id);
    if (!settings.pass.enabled) throw notFound;
    const allowed = settings.pass.visibility === 'link' || user?.phone === row.phone || canManageEvent(user, event);
    const eventInfo = { id: event.id, name: event.name, displayName: event.displayName };
    if (!allowed) return { private: true, event: eventInfo };
    const form = await this.form(event.id, 'registration');
    const { first, last } = firstLast(row.guest_name ?? '');
    const start = event.startTime;
    return {
      private: false,
      owner: user?.phone === row.phone,
      event: {
        ...eventInfo,
        startTime: event.startTime, endTime: event.endTime,
        venueName: event.experience?.venueName ?? '', venueAddress: event.experience?.venueAddress ?? '',
      },
      vendor: { name: event.vendor.name, displayName: event.vendor.displayName, logoUrl: event.vendor.logoUrl },
      template: settings.pass.template,
      design: settings.pass.template.kind === 'design' ? await this.passDesign(Number(settings.pass.template.id), event.vendorId) : null,
      guest: { name: row.guest_name || 'Guest', firstName: first || 'Guest', lastName: last, party: row.party_size },
      pass: { code: row.pass_code, checkedInAt: row.checked_in_at },
      fields: {
        'guest.name': row.guest_name || 'Guest', 'guest.firstName': first || 'Guest', 'guest.lastName': last,
        'guest.party': String(row.party_size), 'pass.code': row.pass_code ?? '',
        'event.name': event.displayName, 'event.venue': event.experience?.venueName ?? '',
        'event.date': start ? start.toISOString() : '', 'event.time': start ? start.toISOString() : '',
        'vendor.name': event.vendor.displayName,
        ...passAnswers(form, row.answers ?? {}),
      },
    };
  },

  /** A vendor's saved Studio design used as the pass template (only that vendor's own designs). */
  async passDesign(designId: number, vendorId: number) {
    const rows = await q<any>(`
      SELECT id, name, width_mm AS "widthMm", height_mm AS "heightMm", elements, library_template_id AS "libraryTemplateId",
             manifest_version AS "manifestVersion", qr_style AS "qrStyle", theme, settings, document
        FROM qr_templates WHERE id = :id AND (vendor_id = :vendorId OR vendor_id IS NULL) LIMIT 1`, { id: designId, vendorId });
    return rows[0] ?? null;
  },

  // ── Vendor side ───────────────────────────────────────────────────────────
  async adminOverview(eventId: number) {
    const event = await this.eventById(eventId);
    const { settings, configured } = await this.settings(eventId);
    const [registration, feedback, regResponses, fbResponses, dispatch] = await Promise.all([
      this.form(eventId, 'registration'), this.form(eventId, 'feedback'),
      this.responseCount(eventId, 'registration'), this.responseCount(eventId, 'feedback'),
      q<any>(`SELECT sent_at AS "sentAt", channel, recipients, delivered FROM event_feedback_dispatch WHERE event_id = :eventId`, { eventId }),
    ]);
    return {
      event: { id: event.id, name: event.name, displayName: event.displayName, startTime: event.startTime, endTime: event.endTime, status: event.status, pageEnabled: Boolean(event.experience?.enabled) },
      configured, settings,
      forms: {
        registration: { ...registration, responses: regResponses, locked: regResponses > 0 },
        feedback: { ...feedback, responses: fbResponses, locked: fbResponses > 0 },
      },
      feedbackDispatch: dispatch[0] ?? null,
      feedbackDueAt: feedbackDueAt(settings, event.endTime),
    };
  },

  async adminList(eventId: number) {
    const event = await this.eventById(eventId);
    const { settings } = await this.settings(eventId);
    const form = await this.form(eventId, 'registration');
    const rows = await q<RegistrationRow>(`SELECT * FROM event_registration WHERE event_id = :eventId ORDER BY registered_at DESC, id DESC`, { eventId });
    const waitOrder = rows.filter((r) => r.status === 'waitlisted').sort((a, b) => (a.waitlist_rank ?? 0) - (b.waitlist_rank ?? 0) || a.id - b.id);
    const feedback = await q<{ phone: string; answers: any; submitted_at: Date }>(`SELECT phone, answers, submitted_at FROM event_feedback WHERE event_id = :eventId`, { eventId });
    const feedbackByPhone = new Map(feedback.map((f) => [f.phone, f]));
    const out = [];
    for (const row of rows) {
      const passToken = await this.ensurePass(row, event, settings);
      out.push({
        id: Number(row.id), phone: row.phone, status: row.status, partySize: row.party_size, guestName: row.guest_name ?? '',
        answers: row.answers ?? {}, formVersion: row.form_version, registeredAt: row.registered_at, updatedAt: row.updated_at,
        waitlistPosition: row.status === 'waitlisted' ? waitOrder.indexOf(row) + 1 : null,
        checkedInAt: row.checked_in_at, checkedInBy: row.checked_in_by, checkInMethod: row.check_in_method,
        cancelledAt: row.cancelled_at, cancelledBy: row.cancelled_by, source: row.source,
        passCode: passToken ? row.pass_code : null, passToken,
        feedback: feedbackByPhone.get(row.phone) ? { answers: feedbackByPhone.get(row.phone)!.answers, submittedAt: feedbackByPhone.get(row.phone)!.submitted_at } : null,
      });
    }
    const taken = out.filter((r) => r.status === 'registered' || r.status === 'pending').reduce((sum, r) => sum + r.partySize, 0);
    const feedbackForm = await this.form(eventId, 'feedback');
    return {
      questions: form.questions, feedbackQuestions: feedbackForm.questions, rows: out,
      summary: {
        capacity: settings.capacity, seatsTaken: taken,
        registered: out.filter((r) => r.status === 'registered').length,
        pending: out.filter((r) => r.status === 'pending').length,
        checkedIn: out.filter((r) => r.checkedInAt).length,
        waitlisted: waitOrder.length,
        cancelled: out.filter((r) => r.status === 'cancelled').length,
      },
      passEnabled: settings.pass.enabled,
    };
  },

  async adminAction(eventId: number, action: string, ids: number[], actor: string, options: { force?: boolean } = {}) {
    const event = await this.eventById(eventId);
    const results: { id: number; ok: boolean; error?: string }[] = [];
    const promoted = await sequelize.transaction(async (transaction) => {
      await exec(`SELECT pg_advisory_xact_lock(:key)`, { key: 5_000_000_000 + event.id }, transaction);
      const { settings } = await this.settings(eventId, transaction);
      const rows = await q<RegistrationRow>(`SELECT * FROM event_registration WHERE event_id = :eventId AND id IN (:ids)`, { eventId, ids: ids.length ? ids : [0] }, transaction);
      let freed = false;
      for (const row of rows) {
        const fail = (error: string) => results.push({ id: Number(row.id), ok: false, error });
        const set = async (sql: string, extra: Record<string, unknown> = {}) => exec(`UPDATE event_registration SET ${sql}, updated_at = NOW() WHERE id = :id`, { id: row.id, actor, ...extra }, transaction);
        const fits = async () => settings.capacity === null || options.force
          || (await this.seatsTaken(eventId, transaction)) + row.party_size <= settings.capacity;
        switch (action) {
          case 'approve':
          case 'promote':
            if (!['pending', 'waitlisted'].includes(row.status)) { fail('Not waiting'); continue; }
            if (row.status === 'waitlisted' && !(await fits())) { fail('No seats left'); continue; }
            await set(`status = 'registered', waitlist_rank = NULL`); row.status = 'registered';
            await this.ensurePass(row, event, settings, transaction);
            break;
          case 'to_waitlist':
            if (!['registered', 'pending'].includes(row.status) || row.checked_in_at) { fail('Can only move confirmed guests who have not checked in'); continue; }
            await set(`status = 'waitlisted', waitlist_rank = :rank, pass_nonce = NULL, pass_token_hash = NULL`, { rank: await this.nextWaitlistRank(eventId, transaction) });
            freed = true;
            break;
          case 'move_up': {
            if (row.status !== 'waitlisted') { fail('Not on the waitlist'); continue; }
            const prev = await q<RegistrationRow>(`SELECT * FROM event_registration WHERE event_id = :eventId AND status = 'waitlisted' AND waitlist_rank < :rank ORDER BY waitlist_rank DESC LIMIT 1`, { eventId, rank: row.waitlist_rank ?? 0 }, transaction);
            if (!prev.length) { fail('Already first'); continue; }
            await exec(`UPDATE event_registration SET waitlist_rank = :r WHERE id = :id`, { r: prev[0].waitlist_rank, id: row.id }, transaction);
            await exec(`UPDATE event_registration SET waitlist_rank = :r WHERE id = :id`, { r: row.waitlist_rank, id: prev[0].id }, transaction);
            break;
          }
          case 'cancel':
            if (row.status === 'cancelled') { fail('Already cancelled'); continue; }
            await set(`status = 'cancelled', cancelled_at = NOW(), cancelled_by = :actor, waitlist_rank = NULL, pass_nonce = NULL, pass_token_hash = NULL`);
            freed = freed || row.status !== 'waitlisted';
            break;
          case 'restore':
            if (row.status !== 'cancelled') { fail('Not cancelled'); continue; }
            if (await fits()) { await set(`status = 'registered', cancelled_at = NULL, cancelled_by = NULL`); row.status = 'registered'; await this.ensurePass(row, event, settings, transaction); }
            else if (settings.waitlist.enabled) await set(`status = 'waitlisted', cancelled_at = NULL, cancelled_by = NULL, waitlist_rank = :rank`, { rank: await this.nextWaitlistRank(eventId, transaction) });
            else { fail('No seats left'); continue; }
            break;
          case 'checkin':
            if (row.status !== 'registered') { fail('Not confirmed'); continue; }
            if (row.checked_in_at) { fail('Already checked in'); continue; }
            await set(`checked_in_at = NOW(), checked_in_by = :actor, check_in_method = 'manual'`);
            await exec(`INSERT INTO event_check_in_log (event_id, registration_id, scanned_by, method, result) VALUES (:eventId, :id, :actor, 'manual', 'ok')`, { eventId, id: row.id, actor }, transaction);
            break;
          case 'undo_checkin':
            if (!row.checked_in_at) { fail('Not checked in'); continue; }
            await set(`checked_in_at = NULL, checked_in_by = NULL, check_in_method = NULL`);
            break;
          case 'reissue_pass':
            if (row.status !== 'registered') { fail('Not confirmed'); continue; }
            await this.ensurePass(row, event, settings, transaction, true);
            break;
          default:
            throw new HttpError(400, 'Unknown action');
        }
        results.push({ id: Number(row.id), ok: true });
      }
      return freed ? this.promoteFromWaitlist(event, settings, transaction) : [];
    });
    await this.notifyPromoted(event, promoted);
    return { results, promoted: promoted.length };
  },

  async viewConfig(eventId: number, phone: string) {
    const rows = await q<{ config: unknown }>(`SELECT config FROM event_registration_view WHERE event_id = :eventId AND phone = :phone`, { eventId, phone });
    return rows[0]?.config ?? {};
  },

  async saveViewConfig(eventId: number, phone: string, raw: any) {
    const config = {
      columns: (Array.isArray(raw?.columns) ? raw.columns : []).map((c: unknown) => String(c).slice(0, 60)).slice(0, 80),
      sort: raw?.sort && typeof raw.sort === 'object' ? { key: String(raw.sort.key ?? '').slice(0, 60), dir: raw.sort.dir === 'asc' ? 'asc' : 'desc' } : null,
    };
    await exec(`
      INSERT INTO event_registration_view (event_id, phone, config, updated_at) VALUES (:eventId, :phone, CAST(:config AS JSONB), NOW())
      ON CONFLICT (event_id, phone) DO UPDATE SET config = EXCLUDED.config, updated_at = NOW()`,
    { eventId, phone, config: JSON.stringify(config) });
    return config;
  },

  // ── Invitations ───────────────────────────────────────────────────────────
  async createInvites(eventId: number, phonesRaw: unknown, actor: string) {
    const phones = [...new Set((Array.isArray(phonesRaw) ? phonesRaw : []).map(normalisePhone).filter(Boolean) as string[])].slice(0, 500);
    if (!phones.length) throw new HttpError(400, 'Add at least one valid phone number.');
    const out: { phone: string; token: string }[] = [];
    await sequelize.transaction(async (transaction) => {
      for (const phone of phones) {
        const existing = await q<{ id: number; nonce: string; revoked_at: Date | null }>(`SELECT id, nonce, revoked_at FROM event_invite WHERE event_id = :eventId AND phone = :phone`, { eventId, phone }, transaction);
        if (existing.length && !existing[0].revoked_at) { out.push({ phone, token: deriveToken('invite', existing[0].id, existing[0].nonce) }); continue; }
        const nonce = newNonce();
        let id: number;
        if (existing.length) {
          id = existing[0].id;
        } else {
          const inserted = await q<{ id: number }>(`INSERT INTO event_invite (event_id, phone, nonce, token_hash, created_by) VALUES (:eventId, :phone, :nonce, :placeholder, :actor) RETURNING id`,
            { eventId, phone, nonce, placeholder: `pending-${nonce}`, actor }, transaction);
          id = inserted[0].id;
        }
        const token = deriveToken('invite', id, nonce);
        await exec(`UPDATE event_invite SET nonce = :nonce, token_hash = :hash, revoked_at = NULL WHERE id = :id`, { nonce, hash: hashToken(token), id }, transaction);
        out.push({ phone, token });
      }
    });
    return out;
  },

  async listInvites(eventId: number) {
    const rows = await q<any>(`SELECT id, phone, nonce, created_at, used_at, revoked_at FROM event_invite WHERE event_id = :eventId ORDER BY created_at DESC`, { eventId });
    return rows.map((r) => ({ id: Number(r.id), phone: r.phone, token: r.revoked_at ? null : deriveToken('invite', r.id, r.nonce), createdAt: r.created_at, usedAt: r.used_at, revokedAt: r.revoked_at }));
  },

  async revokeInvite(eventId: number, inviteId: number) {
    await exec(`UPDATE event_invite SET revoked_at = NOW() WHERE event_id = :eventId AND id = :id`, { eventId, id: inviteId });
    return { ok: true };
  },

  async invite(token: string) {
    const clean = extractToken(token);
    if (!clean) throw new HttpError(404, 'Invitation not found');
    const rows = await q<any>(`SELECT i.phone, i.revoked_at, e.name FROM event_invite i JOIN event e ON e.id = i.event_id WHERE i.token_hash = :hash`, { hash: hashToken(clean) });
    if (!rows.length || rows[0].revoked_at) throw new HttpError(404, 'Invitation not found');
    return { eventName: rows[0].name, phoneHint: maskPhone(rows[0].phone), token: clean };
  },

  // ── Check-in ──────────────────────────────────────────────────────────────
  async checkInAccess(eventId: number, user: AuthPayload | null) {
    if (!user) throw new HttpError(401, 'Sign in to check guests in.');
    const event = await this.eventById(eventId);
    if (canManageEvent(user, event)) return { event, role: 'host' as const };
    const { settings } = await this.settings(eventId);
    if (!settings.pass.staffPhones.includes(user.phone)) throw new HttpError(403, 'This number is not on the door staff list for this event.');
    if (!staffAccessOpen(event.startTime, event.endTime)) throw new HttpError(403, 'Door staff access for this event has ended.');
    return { event, role: 'staff' as const };
  },

  async checkInSummary(eventId: number) {
    const rows = await q<any>(`SELECT COUNT(*) FILTER (WHERE status = 'registered') AS registered,
                                      COUNT(*) FILTER (WHERE status = 'registered' AND checked_in_at IS NOT NULL) AS "checkedIn",
                                      COALESCE(SUM(party_size) FILTER (WHERE status = 'registered'), 0) AS guests,
                                      COALESCE(SUM(party_size) FILTER (WHERE status = 'registered' AND checked_in_at IS NOT NULL), 0) AS "guestsIn"
                                 FROM event_registration WHERE event_id = :eventId`, { eventId });
    const r = rows[0] ?? {};
    return { registered: Number(r.registered ?? 0), checkedIn: Number(r.checkedIn ?? 0), guests: Number(r.guests ?? 0), guestsIn: Number(r.guestsIn ?? 0) };
  },

  async scan(eventId: number, rawToken: unknown, actor: string) {
    const token = extractToken(rawToken);
    const log = (result: string, registrationId: number | null = null) =>
      exec(`INSERT INTO event_check_in_log (event_id, registration_id, scanned_by, method, result) VALUES (:eventId, :rid, :actor, 'scan', :result)`,
        { eventId, rid: registrationId, actor, result }).catch(() => undefined);
    if (!token) { await log('invalid'); return { result: 'invalid' as const, message: 'This is not a Peshkash pass.' }; }
    const rows = await q<RegistrationRow>(`SELECT * FROM event_registration WHERE pass_token_hash = :hash LIMIT 1`, { hash: hashToken(token) });
    const row = rows[0];
    if (!row) {
      // Cancelled and re-issued passes have no hash any more, so they land here too.
      await log('invalid');
      return { result: 'invalid' as const, message: 'Pass not valid. It may have been cancelled or replaced.' };
    }
    if (Number(row.event_id) !== Number(eventId)) { await log('wrong_event'); return { result: 'wrong_event' as const, message: 'This pass is for a different event.' }; }
    const guest = { name: row.guest_name || 'Guest', party: row.party_size, last4: row.phone.replace(/\D/g, '').slice(-4), answers: row.answers ?? {} };
    if (row.status !== 'registered') { await log(row.status, row.id); return { result: 'not_confirmed' as const, message: `Registration is ${row.status}.`, guest }; }
    const updated = await q<{ checked_in_at: Date }>(
      `UPDATE event_registration SET checked_in_at = NOW(), checked_in_by = :actor, check_in_method = 'scan', updated_at = NOW()
        WHERE id = :id AND checked_in_at IS NULL RETURNING checked_in_at`, { id: row.id, actor });
    if (!updated.length) {
      await log('duplicate', row.id);
      return { result: 'duplicate' as const, message: 'Already checked in.', guest, checkedInAt: row.checked_in_at, checkedInBy: row.checked_in_by };
    }
    await log('ok', row.id);
    return { result: 'ok' as const, message: 'Checked in.', guest, checkedInAt: updated[0].checked_in_at, checkedInBy: actor };
  },

  async searchGuests(eventId: number, query: string) {
    const term = String(query ?? '').trim().slice(0, 60);
    if (term.length < 2) return [];
    const digits = term.replace(/\D/g, '');
    const rows = await q<RegistrationRow>(`
      SELECT * FROM event_registration
       WHERE event_id = :eventId AND status = 'registered'
         AND (guest_name ILIKE :like ${digits.length >= 3 ? `OR regexp_replace(phone, '\\D', '', 'g') LIKE :digits` : ''})
       ORDER BY guest_name NULLS LAST LIMIT 20`, { eventId, like: `%${term}%`, digits: `%${digits}` });
    return rows.map((r) => ({ id: Number(r.id), name: r.guest_name || 'Guest', last4: r.phone.replace(/\D/g, '').slice(-4), party: r.party_size, checkedInAt: r.checked_in_at }));
  },

  // ── Feedback dispatch ─────────────────────────────────────────────────────
  async feedbackRecipients(eventId: number, audience: 'checked_in' | 'all') {
    return q<{ id: number; phone: string; guest_name: string | null }>(
      `SELECT id, phone, guest_name FROM event_registration WHERE event_id = :eventId AND status = 'registered' ${audience === 'checked_in' ? 'AND checked_in_at IS NOT NULL' : ''}
         AND phone NOT IN (SELECT phone FROM event_feedback WHERE event_id = :eventId)`, { eventId });
  },

  async dispatchFeedback(eventId: number, actor: string) {
    const event = await this.eventById(eventId);
    const { settings } = await this.settings(eventId);
    if (!settings.feedback.enabled) throw new HttpError(409, 'Turn on feedback for this event first.');
    const recipients = await this.feedbackRecipients(eventId, settings.feedback.audience);
    const url = `/event/${event.name}?feedback=1`;
    const message = `How was ${event.displayName}? ${event.vendor.displayName} would love your feedback.`;
    let delivered = 0;
    if (settings.feedback.channel === 'push') {
      delivered = (await this.notify(recipients.map((r) => r.phone), event.displayName, message, url)).delivered;
    } else if (settings.feedback.channel === 'whatsapp' && whatsappConfigured()) {
      for (const r of recipients) {
        const result = await sendWhatsApp(r.phone, { id: 0, title: event.displayName, message: `${message} https://peshkash.app${url}`, templateKey: 'event_feedback', vendorName: event.vendor.displayName, destinationPath: url });
        if (result.ok) delivered += 1;
      }
    }
    await exec(`
      INSERT INTO event_feedback_dispatch (event_id, sent_at, sent_by, channel, recipients, delivered)
      VALUES (:eventId, NOW(), :actor, :channel, :n, :delivered)
      ON CONFLICT (event_id) DO UPDATE SET sent_at = NOW(), sent_by = EXCLUDED.sent_by, channel = EXCLUDED.channel, recipients = EXCLUDED.recipients, delivered = EXCLUDED.delivered`,
    { eventId, actor, channel: settings.feedback.channel, n: recipients.length, delivered });
    return {
      channel: settings.feedback.channel, delivered, url,
      recipients: recipients.map((r) => ({ id: Number(r.id), phone: r.phone, name: r.guest_name ?? '' })),
      message,
    };
  },

  /** Called by the feedback worker: sends every scheduled request that is now due. */
  async dispatchDueFeedback(now = Date.now()) {
    const rows = await q<{ event_id: number; settings: unknown; end_time: Date | null }>(`
      SELECT s.event_id, s.settings, e.end_time FROM event_registration_settings s
        JOIN event e ON e.id = s.event_id
       WHERE (s.settings->'feedback'->>'enabled')::boolean IS TRUE
         AND s.settings->'feedback'->>'when' IN ('after','at')
         AND NOT EXISTS (SELECT 1 FROM event_feedback_dispatch d WHERE d.event_id = s.event_id)`);
    let sent = 0;
    for (const row of rows) {
      const due = feedbackDueAt(cleanRegistrationSettings(row.settings), row.end_time);
      if (!due || due.getTime() > now) continue;
      await this.dispatchFeedback(Number(row.event_id), 'scheduler').catch((error) => console.error('[Feedback] dispatch failed', row.event_id, error?.message));
      sent += 1;
    }
    return sent;
  },
};
