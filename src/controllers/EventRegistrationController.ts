import { Request, Response } from 'express';
import { EventRegistrationService, HttpError } from '../services/EventRegistrationService';
import { RegistrationUploadService } from '../services/RegistrationUploadService';
import { AnalyticsRecorder } from '../services/AnalyticsRecorder';
import type { FormKind } from '../utils/RegistrationFormUtil';

/** Uniform JSON errors: { error, details? } with the service's status code. */
function handle(res: Response, work: () => Promise<unknown>, status = 200) {
  work()
    .then((data) => { res.set('Cache-Control', 'no-store'); res.status(status).json(data); })
    .catch((err: any) => {
      if (err instanceof HttpError) { res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) }); return; }
      if (err?.status && err?.message) { res.status(err.status).json({ error: err.message }); return; }
      console.error('[Registration]', err);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    });
}

const eventId = (req: Request) => {
  const id = Number(req.params.eventId);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Valid eventId is required');
  return id;
};
const actor = (req: Request) => req.user!.phone;

/** Guest-facing endpoints, mounted at /api/registration. */
export const RegistrationPublicController = {
  context: (req: Request, res: Response) => handle(res, () => EventRegistrationService.publicContext(req.params.eventName, req.user)),

  register: (req: Request, res: Response) => handle(res, async () => {
    const result: any = await EventRegistrationService.register(req.params.eventName, req.user!, req.body);
    if (!result.duplicate && result.event) {
      // Only confirmed seats count as registrations in analytics.
      const status = result.me?.status;
      const actionType = status === 'registered' ? 'event_registration' : status === 'waitlisted' ? 'event_waitlist_join' : 'event_registration_request';
      AnalyticsRecorder.recordAction({
        actionType, eventId: Number(result.event.id), vendorId: Number(result.event.vendorId),
        phone: req.user!.phone, pageUrl: req.body?.pageUrl,
      }, req);
    }
    return { duplicate: result.duplicate, me: result.me };
  }),

  cancel: (req: Request, res: Response) => handle(res, async () => {
    const result = await EventRegistrationService.cancelOwn(req.params.eventName, req.user!);
    const event = await EventRegistrationService.eventByName(req.params.eventName).catch(() => null);
    if (event) AnalyticsRecorder.recordAction({ actionType: 'event_registration_cancel', eventId: event.id, vendorId: event.vendorId, phone: req.user!.phone }, req);
    return result;
  }),
  feedback: (req: Request, res: Response) => handle(res, () => EventRegistrationService.submitFeedback(req.params.eventName, req.user!, req.body)),

  upload: (req: Request, res: Response) => handle(res, async () => {
    const event = await EventRegistrationService.eventByName(req.params.eventName);
    if (!event.experience?.enabled) throw new HttpError(404, 'Event page not found');
    return RegistrationUploadService.upload(event.id, req.user!.phone, req.file as Express.Multer.File);
  }, 201),

  pass: (req: Request, res: Response) => handle(res, () => EventRegistrationService.pass(req.params.token, req.user)),
  invite: (req: Request, res: Response) => handle(res, () => EventRegistrationService.invite(req.params.token)),
};

/** Vendor workspace endpoints, mounted at /api/admin/event-registration/:eventId. */
export const RegistrationAdminController = {
  overview: (req: Request, res: Response) => handle(res, () => EventRegistrationService.adminOverview(eventId(req))),
  saveSettings: (req: Request, res: Response) => handle(res, async () => {
    const settings = await EventRegistrationService.saveSettings(eventId(req), req.body?.settings ?? req.body, actor(req));
    return { settings };
  }),
  saveForm: (req: Request, res: Response) => handle(res, async () => {
    const kind = req.params.kind as FormKind;
    if (kind !== 'registration' && kind !== 'feedback') throw new HttpError(400, 'Unknown form');
    return EventRegistrationService.saveForm(eventId(req), kind, req.body?.form ?? req.body, actor(req));
  }),
  list: (req: Request, res: Response) => handle(res, () => EventRegistrationService.adminList(eventId(req))),
  action: (req: Request, res: Response) => handle(res, async () => {
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter((n: number) => Number.isInteger(n) && n > 0).slice(0, 1000);
    if (!ids.length) throw new HttpError(400, 'Select at least one registration.');
    await EventRegistrationService.ensureConfigured(eventId(req), actor(req));
    return EventRegistrationService.adminAction(eventId(req), String(req.body?.action ?? ''), ids, actor(req), { force: req.body?.force === true });
  }),
  view: (req: Request, res: Response) => handle(res, () => EventRegistrationService.viewConfig(eventId(req), actor(req))),
  saveView: (req: Request, res: Response) => handle(res, () => EventRegistrationService.saveViewConfig(eventId(req), actor(req), req.body)),
  invites: (req: Request, res: Response) => handle(res, () => EventRegistrationService.listInvites(eventId(req))),
  createInvites: (req: Request, res: Response) => handle(res, () => EventRegistrationService.createInvites(eventId(req), req.body?.phones, actor(req)), 201),
  revokeInvite: (req: Request, res: Response) => handle(res, () => EventRegistrationService.revokeInvite(eventId(req), Number(req.params.inviteId))),
  sendFeedback: (req: Request, res: Response) => handle(res, () => EventRegistrationService.dispatchFeedback(eventId(req), actor(req))),
  file: (req: Request, res: Response) => handle(res, () => RegistrationUploadService.signedUrl(eventId(req), String(req.query.path ?? ''))),
  notify: (req: Request, res: Response) => handle(res, async () => {
    const event = await EventRegistrationService.eventById(eventId(req));
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter((n: number) => n > 0).slice(0, 1000);
    const title = String(req.body?.title ?? event.displayName).slice(0, 120);
    const message = String(req.body?.message ?? '').slice(0, 500);
    if (!ids.length || !message) throw new HttpError(400, 'Choose recipients and write a message.');
    const list = await EventRegistrationService.adminList(event.id);
    const chosen = list.rows.filter((r) => ids.includes(r.id) && r.status !== 'cancelled');
    let delivered = 0;
    for (const row of chosen) {
      const url = row.passToken ? `/t/${row.passToken}` : `/event/${event.name}`;
      delivered += (await EventRegistrationService.notify([row.phone], title, message, url)).delivered;
    }
    return { attempted: chosen.length, delivered };
  }),
};

/** Door check-in, mounted at /api/checkin/:eventId. Vendor admins or the event's door staff. */
export const CheckInController = {
  /** GET /api/checkin — every event this person can check guests in for right now. */
  events: (req: Request, res: Response) => handle(res, () => EventRegistrationService.checkInEvents(req.user!)),
  access: (req: Request, res: Response) => handle(res, async () => {
    const { event, role } = await EventRegistrationService.checkInAccess(eventId(req), req.user);
    return {
      role,
      event: { id: event.id, name: event.name, displayName: event.displayName, startTime: event.startTime, endTime: event.endTime, vendor: event.vendor.displayName },
      summary: await EventRegistrationService.checkInSummary(event.id),
    };
  }),
  scan: (req: Request, res: Response) => handle(res, async () => {
    const { event } = await EventRegistrationService.checkInAccess(eventId(req), req.user);
    const result = await EventRegistrationService.scan(event.id, req.body?.token, actor(req));
    return { ...result, summary: await EventRegistrationService.checkInSummary(event.id) };
  }),
  search: (req: Request, res: Response) => handle(res, async () => {
    const { event } = await EventRegistrationService.checkInAccess(eventId(req), req.user);
    return EventRegistrationService.searchGuests(event.id, String(req.query.q ?? ''));
  }),
  manual: (req: Request, res: Response) => handle(res, async () => {
    const { event } = await EventRegistrationService.checkInAccess(eventId(req), req.user);
    const id = Number(req.body?.registrationId);
    const result = await EventRegistrationService.adminAction(event.id, req.body?.undo ? 'undo_checkin' : 'checkin', [id], actor(req));
    return { ...result, summary: await EventRegistrationService.checkInSummary(event.id) };
  }),
};
