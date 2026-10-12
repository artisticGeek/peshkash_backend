import { QueryTypes } from 'sequelize';
import { sequelize } from '../config/sequelize';
import { EventRegistrationService } from './EventRegistrationService';

/**
 * Peshkash 5.0 — a signed-in person's events: registrations (any flow), saved
 * events, recently visited event pages and an event activity trail.
 *
 * Read-only over existing tables. Identity is the verified phone, plus any
 * device that phone has signed in on (device_link), exactly like item history.
 */

/** Analytics actions that belong to a person's event trail. */
export const EVENT_TRAIL_ACTIONS = ['event_page_view', 'event_bookmark', 'event_unbookmark', 'event_share_click', 'pass_save', 'pass_share'];

type EventCols = {
  event_id: string; slug: string; display_name: string | null; start_time: Date | null; end_time: Date | null;
  event_status: string | null; experience: Record<string, any> | null; vendor_name: string | null;
};

const EVENT_COLS = `
  e.id AS event_id, e.name AS slug, COALESCE(e.display_name, e.name) AS display_name,
  e.start_time, e.end_time, e.status AS event_status, e.experience_config AS experience,
  COALESCE(v.display_name, v.name) AS vendor_name`;

const q = <T extends object>(sql: string, replacements: Record<string, unknown>) =>
  sequelize.query<T>(sql, { replacements, type: QueryTypes.SELECT });

function timing(row: Pick<EventCols, 'start_time' | 'end_time'>): 'upcoming' | 'live' | 'ended' | 'unscheduled' {
  const now = Date.now();
  const start = row.start_time ? new Date(row.start_time).getTime() : null;
  const end = row.end_time ? new Date(row.end_time).getTime() : null;
  if (end !== null && now > end) return 'ended';
  if (start !== null && now < start) return 'upcoming';
  if (start !== null) return 'live';
  return 'unscheduled';
}

export function eventCard(row: EventCols) {
  const exp = row.experience ?? {};
  const live = row.event_status === 'active';
  return {
    eventId: Number(row.event_id),
    name: row.slug,
    displayName: row.display_name || row.slug,
    startTime: row.start_time, endTime: row.end_time,
    venueName: typeof exp.venueName === 'string' ? exp.venueName : '',
    image: typeof exp.heroImageUrl === 'string' && exp.heroImageUrl ? exp.heroImageUrl : null,
    vendorName: row.vendor_name,
    timing: timing(row),
    available: live,
    path: live ? `/event/${row.slug}` : null,
  };
}

const PHONE_MATCH = `LEFT JOIN device_link dl ON dl.device_id = ae.device_id
  WHERE COALESCE(dl.phone, ae.phone) = :phone`;

export const UserEventsService = {
  async registrations(phone: string) {
    const rows = await q<EventCols & {
      id: string; status: string; party_size: number | null; guest_name: string | null; registered_at: Date;
      cancelled_at: Date | null; checked_in_at: Date | null; pass_nonce: string | null; pass_code: string | null;
      waitlist_rank: string | null; event_id: string; phone: string;
    }>(
      `SELECT r.id, r.status, r.party_size, r.guest_name, r.registered_at, r.cancelled_at, r.checked_in_at,
              r.pass_nonce, r.pass_code, r.waitlist_rank, r.phone, ${EVENT_COLS}
         FROM event_registration r
         JOIN event e ON e.id = r.event_id
         LEFT JOIN vendor v ON v.id = e.vendor_id
        WHERE r.phone = :phone
        ORDER BY COALESCE(e.start_time, r.registered_at) DESC`,
      { phone },
    );
    const out = [];
    for (const row of rows) {
      const status = row.status || 'registered';
      out.push({
        id: Number(row.id),
        event: eventCard(row),
        status,
        partySize: row.party_size ?? 1,
        guestName: row.guest_name ?? '',
        registeredAt: row.registered_at,
        cancelledAt: row.cancelled_at,
        checkedInAt: row.checked_in_at,
        waitlistPosition: status === 'waitlisted' ? await EventRegistrationService.waitlistPosition(row as any) : null,
        passToken: status === 'registered' && row.pass_nonce ? EventRegistrationService.passToken({ id: Number(row.id), pass_nonce: row.pass_nonce }) : null,
        passCode: status === 'registered' && row.pass_nonce ? row.pass_code : null,
      });
    }
    return out;
  },

  async saved(phone: string) {
    const rows = await q<EventCols & { saved_at: Date }>(
      `SELECT latest.created_at AS saved_at, ${EVENT_COLS}
         FROM (
           SELECT DISTINCT ON (ae.event_id) ae.event_id, ae.action_type, ae.created_at
             FROM analytics_event ae ${PHONE_MATCH}
              AND ae.event_id IS NOT NULL AND ae.action_type IN ('event_bookmark', 'event_unbookmark')
            ORDER BY ae.event_id, ae.created_at DESC, ae.id DESC
         ) latest
         JOIN event e ON e.id = latest.event_id
         LEFT JOIN vendor v ON v.id = e.vendor_id
        WHERE latest.action_type = 'event_bookmark'
        ORDER BY latest.created_at DESC`,
      { phone },
    );
    return rows.map((row) => ({ savedAt: row.saved_at, event: eventCard(row) }));
  },

  async isSaved(phone: string, eventId: number) {
    const rows = await q<{ action_type: string }>(
      `SELECT ae.action_type FROM analytics_event ae ${PHONE_MATCH}
          AND ae.event_id = :eventId AND ae.action_type IN ('event_bookmark', 'event_unbookmark')
        ORDER BY ae.created_at DESC, ae.id DESC LIMIT 1`,
      { phone, eventId },
    );
    return rows[0]?.action_type === 'event_bookmark';
  },

  async visited(phone: string, limit = 30) {
    const rows = await q<EventCols & { last_visit: Date; visits: string }>(
      `SELECT seen.last_visit, seen.visits, ${EVENT_COLS}
         FROM (
           SELECT ae.event_id, MAX(ae.created_at) AS last_visit, COUNT(*) AS visits
             FROM analytics_event ae ${PHONE_MATCH}
              AND ae.event_id IS NOT NULL AND ae.action_type = 'event_page_view'
            GROUP BY ae.event_id
         ) seen
         JOIN event e ON e.id = seen.event_id
         LEFT JOIN vendor v ON v.id = e.vendor_id
        ORDER BY seen.last_visit DESC
        LIMIT :limit`,
      { phone, limit },
    );
    return rows.map((row) => ({ lastVisit: row.last_visit, visits: Number(row.visits), event: eventCard(row) }));
  },

  /**
   * Event trail: page visits (one per event per day), saves, shares, pass
   * saves, and registration milestones from event_registration itself.
   */
  async activity(phone: string, opts: { from: Date; q: string; limit: number; offset: number }) {
    const base = `
      WITH acts AS (
        SELECT 'a' || ae.id AS id, ae.created_at AS occurred_at, ae.action_type, ae.event_id
          FROM analytics_event ae ${PHONE_MATCH}
           AND ae.event_id IS NOT NULL AND ae.item_id IS NULL AND ae.action_type IN (:actions)
      ), views AS (
        SELECT DISTINCT ON (event_id, date_trunc('day', occurred_at)) id, occurred_at, action_type, event_id
          FROM acts WHERE action_type = 'event_page_view'
         ORDER BY event_id, date_trunc('day', occurred_at), occurred_at DESC
      ), trail AS (
        SELECT * FROM views
        UNION ALL SELECT * FROM acts WHERE action_type <> 'event_page_view'
        UNION ALL SELECT 'r' || id || 'a', registered_at, 'event_registered', event_id FROM event_registration WHERE phone = :phone
        UNION ALL SELECT 'r' || id || 'c', cancelled_at, 'event_cancelled', event_id FROM event_registration WHERE phone = :phone AND cancelled_at IS NOT NULL
        UNION ALL SELECT 'r' || id || 'i', checked_in_at, 'event_checked_in', event_id FROM event_registration WHERE phone = :phone AND checked_in_at IS NOT NULL
      )`;
    const filter = `
      FROM trail t
      JOIN event e ON e.id = t.event_id
      LEFT JOIN vendor v ON v.id = e.vendor_id
     WHERE t.occurred_at >= :from
       ${opts.q ? `AND (COALESCE(e.display_name, e.name) ILIKE :q OR COALESCE(v.display_name, v.name, '') ILIKE :q)` : ''}`;
    const replacements = { phone, actions: EVENT_TRAIL_ACTIONS, from: opts.from, q: `%${opts.q}%`, limit: opts.limit, offset: opts.offset };
    const [rows, totals] = await Promise.all([
      q<EventCols & { id: string; occurred_at: Date; action_type: string }>(
        `${base} SELECT t.id, t.occurred_at, t.action_type, ${EVENT_COLS} ${filter}
          ORDER BY t.occurred_at DESC, t.id DESC LIMIT :limit OFFSET :offset`,
        replacements,
      ),
      q<{ total: string }>(`${base} SELECT COUNT(*) AS total ${filter}`, replacements),
    ]);
    return {
      rows: rows.map((row) => ({ id: row.id, occurredAt: row.occurred_at, actionType: row.action_type, event: eventCard(row) })),
      total: Number(totals[0]?.total ?? 0),
    };
  },
};
