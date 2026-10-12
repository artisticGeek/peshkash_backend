import { Request, Response } from 'express';
import { UserEventsService } from '../services/UserEventsService';

/** Peshkash 5.0 — the signed-in person's events for /home (additive; item history is unchanged). */
export const UserEventsController = {
  /** GET /api/user/events — the person's registrations (for pass links) and saved events. */
  overview: async (req: Request, res: Response) => {
    try {
      const phone = req.user!.phone;
      const [registrations, saved] = await Promise.all([
        UserEventsService.registrations(phone),
        UserEventsService.saved(phone),
      ]);
      return res.json({ registrations, saved });
    } catch (error) {
      console.error('[UserEvents] overview error:', error);
      return res.status(500).json({ error: 'Your events are temporarily unavailable.' });
    }
  },

  /** GET /api/user/events/activity?q&range&page&pageSize — same paging contract as /history/audit. */
  activity: async (req: Request, res: Response) => {
    try {
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(50, Math.max(3, Number(req.query.pageSize) || 20));
      const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
      const range = ['7d', '30d', '90d', 'all'].includes(String(req.query.range)) ? String(req.query.range) : '30d';
      const days = range === '7d' ? 7 : range === '90d' ? 90 : range === 'all' ? null : 30;
      const from = days == null ? new Date('2020-01-01T00:00:00.000Z') : new Date(Date.now() - days * 86_400_000);
      const { rows, total } = await UserEventsService.activity(req.user!.phone, { from, q, limit: pageSize, offset: (page - 1) * pageSize });
      return res.json({ rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)), range, q });
    } catch (error) {
      console.error('[UserEvents] activity error:', error);
      return res.status(500).json({ error: 'Event activity is temporarily unavailable.' });
    }
  },

  /** GET /api/user/events/:eventId/state — { saved } for the event page's Save button. */
  state: async (req: Request, res: Response) => {
    const eventId = Number(req.params.eventId);
    if (!Number.isFinite(eventId) || eventId <= 0) return res.status(400).json({ error: 'Invalid event.' });
    try {
      return res.json({ saved: await UserEventsService.isSaved(req.user!.phone, eventId) });
    } catch (error) {
      console.error('[UserEvents] state error:', error);
      return res.status(500).json({ error: 'Event state is temporarily unavailable.' });
    }
  },
};
