import { Request, Response } from 'express';
import { QueryTypes } from 'sequelize';
import { sequelize } from '../config/sequelize';
import { AdminService } from '../services/AdminService';

function getOrigin(req: Request) {
  return process.env.PUBLIC_APP_URL || req.get('origin') || `${req.protocol}://${req.get('host')}`;
}

function studioActor(req: Request) {
  return { role: req.user?.role || 'customer', vendorId: req.user?.vendorId };
}

function handle(res: Response, promise: Promise<any>, status = 200) {
  promise
    .then((data) => res.status(status).json(data))
    .catch((err: any) => {
      console.error('Admin API error:', err);
      res.status(err.status ?? 500).json({ message: err.message ?? 'Internal server error' });
    });
}

export const AdminController = {
  listVendors: (_req: Request, res: Response) => handle(res, AdminService.listVendors()),
  createVendor: (req: Request, res: Response) => handle(res, AdminService.createVendor(req.body), 201),
  updateVendor: (req: Request, res: Response) =>
    handle(res, AdminService.updateVendor(Number(req.params.vendorId), req.body)),

  listEvents: (_req: Request, res: Response) => handle(res, AdminService.listEvents()),
  createEvent: (req: Request, res: Response) => handle(res, AdminService.createEvent(req.body), 201),
  updateEvent: (req: Request, res: Response) =>
    handle(res, AdminService.updateEvent(Number(req.params.eventId), req.body)),
  updateEventExperience: (req: Request, res: Response) =>
    handle(res, AdminService.updateEventExperience(Number(req.params.eventId), req.body)),

  listMenus: (_req: Request, res: Response) => handle(res, AdminService.listMenus()),
  createMenu: (req: Request, res: Response) => handle(res, AdminService.createMenu(req.body), 201),
  updateMenu: (req: Request, res: Response) =>
    handle(res, AdminService.updateMenu(Number(req.params.menuId), req.body)),

  listEventMenus: (req: Request, res: Response) =>
    handle(res, AdminService.listEventMenus(Number(req.params.eventId))),
  listEventRegistrations: async (req: Request, res: Response) => {
    try {
      const eventId = Number(req.params.eventId);
      if (!eventId) return res.status(400).json({ message: 'Valid eventId is required' });
      const vendorId = req.user?.role === 'vendor' ? Number(req.user.vendorId) : null;
      const from = req.query.from ? new Date(String(req.query.from)) : null;
      const to = req.query.to ? new Date(String(req.query.to)) : null;
      if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime())) || (from && to && from >= to)) {
        return res.status(400).json({ message: 'A valid registration date range is required' });
      }
      const dateFilters = [
        ...(from ? ['AND r.registered_at >= :from'] : []),
        ...(to ? ['AND r.registered_at <= :to'] : []),
      ].join('\n');
      const rows = await sequelize.query(
        `SELECT r.id, r.phone, r.registered_at AS "registeredAt", r.updated_at AS "updatedAt"
           FROM event_registration r
           JOIN event e ON e.id = r.event_id
          WHERE r.event_id = :eventId
            AND (:vendorId IS NULL OR e.vendor_id = :vendorId)
            ${dateFilters}
          ORDER BY r.registered_at DESC`,
        { replacements: { eventId, vendorId, ...(from ? { from: from.toISOString() } : {}), ...(to ? { to: to.toISOString() } : {}) }, type: QueryTypes.SELECT },
      );
      return res.json(rows);
    } catch (err: any) {
      return res.status(500).json({ message: err.message ?? 'Could not load registrations' });
    }
  },
  linkMenuToEvent: (req: Request, res: Response) =>
    handle(res, AdminService.linkMenuToEvent(Number(req.params.eventId), Number(req.params.menuId), req.body?.displayName), 201),
  unlinkMenuFromEvent: (req: Request, res: Response) =>
    handle(res, AdminService.unlinkMenuFromEvent(Number(req.params.eventId), Number(req.params.menuId))),

  listItems: (req: Request, res: Response) =>
    handle(res, AdminService.listItems(req.query.menuId ? Number(req.query.menuId) : undefined)),
  createItem: (req: Request, res: Response) => handle(res, AdminService.createItem(req.body), 201),
  updateItem: (req: Request, res: Response) =>
    handle(res, AdminService.updateItem(Number(req.params.itemId), req.body)),

  setEventStatus: (req: Request, res: Response) =>
    handle(res, AdminService.setEventStatus(Number(req.params.eventId), req.body?.status)),

  getItemPool: (req: Request, res: Response) =>
    handle(res, AdminService.getItemPool(Number(req.params.vendorId))),

  copyMenu: (req: Request, res: Response) =>
    handle(res, AdminService.copyMenu(Number(req.params.menuId), req.body), 201),

  listQrMappings: (req: Request, res: Response) =>
    handle(res, AdminService.listQrMappings({ origin: getOrigin(req) }, req.query.vendorId ? Number(req.query.vendorId) : undefined)),
  upsertQrMapping: (req: Request, res: Response) =>
    handle(res, AdminService.upsertQrMapping(req.body, { origin: getOrigin(req) }), 201),
  updateQrMapping: (req: Request, res: Response) =>
    handle(res, AdminService.updateQrMapping(Number(req.params.id), req.body, { origin: getOrigin(req) })),
  getOrCreateEventQr: (req: Request, res: Response) =>
    handle(res, AdminService.getOrCreateEventQr(Number(req.params.eventId), { origin: getOrigin(req) }), 201),

  listQrTemplates: (req: Request, res: Response) => handle(res, AdminService.listQrTemplates(studioActor(req))),
  getQrTemplate: (req: Request, res: Response) =>
    handle(res, AdminService.getQrTemplate(Number(req.params.id), studioActor(req))),
  createQrTemplate: (req: Request, res: Response) => handle(res, AdminService.createQrTemplate(req.body, studioActor(req)), 201),
  updateQrTemplate: (req: Request, res: Response) =>
    handle(res, AdminService.updateQrTemplate(Number(req.params.id), req.body, studioActor(req))),
  duplicateQrTemplate: (req: Request, res: Response) =>
    handle(res, AdminService.duplicateQrTemplate(Number(req.params.id), req.body, studioActor(req)), 201),
  validateQrTemplate: (req: Request, res: Response) =>
    handle(res, AdminService.validateQrTemplate(Number(req.params.id), studioActor(req))),
  deleteQrTemplate: (req: Request, res: Response) =>
    handle(res, AdminService.deleteQrTemplate(Number(req.params.id), studioActor(req))),

  deleteVendor: (req: Request, res: Response) =>
    handle(res, AdminService.deleteVendor(Number(req.params.vendorId))),
  deleteEvent: (req: Request, res: Response) =>
    handle(res, AdminService.deleteEvent(Number(req.params.eventId))),
  deleteMenu: (req: Request, res: Response) =>
    handle(res, AdminService.deleteMenu(Number(req.params.menuId))),
  deleteItem: (req: Request, res: Response) =>
    handle(res, AdminService.deleteItem(Number(req.params.itemId))),
  deleteQrMapping: (req: Request, res: Response) =>
    handle(res, AdminService.deleteQrMapping(Number(req.params.id))),

  getPreviews: (req: Request, res: Response) =>
    handle(res, AdminService.getPreviews({ origin: getOrigin(req) })),
  buildMenuPath: (req: Request, res: Response) =>
    handle(
      res,
      AdminService.buildMenuPath(Number(req.query.eventId), Number(req.query.menuId), { origin: getOrigin(req) })
    ),
  buildItemPath: (req: Request, res: Response) =>
    handle(
      res,
      AdminService.buildItemPath(Number(req.query.eventId), Number(req.query.itemId), { origin: getOrigin(req) })
    ),

  // ── Session invalidation ────────────────────────────────────────────────────

  listSessionInvalidations: async (_req: Request, res: Response) => {
    try {
      const rows = await sequelize.query(
        `SELECT phone, invalidate_before, created_at FROM session_invalidation ORDER BY created_at DESC`,
        { type: QueryTypes.SELECT },
      );
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  },

  forceLogout: async (req: Request, res: Response) => {
    const phone = String(req.body?.phone ?? '').trim();
    if (!phone) { res.status(400).json({ message: 'phone is required' }); return; }
    try {
      await sequelize.query(
        `INSERT INTO session_invalidation (phone, invalidate_before)
         VALUES (:phone, NOW())
         ON CONFLICT (phone) DO UPDATE SET invalidate_before = NOW(), created_at = NOW()`,
        { replacements: { phone }, type: QueryTypes.INSERT },
      );
      res.json({ ok: true, phone });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  },

  forceLogoutAll: async (_req: Request, res: Response) => {
    try {
      await sequelize.query(
        `INSERT INTO session_invalidation (phone, invalidate_before)
         VALUES ('__global__', NOW())
         ON CONFLICT (phone) DO UPDATE SET invalidate_before = NOW(), created_at = NOW()`,
        { type: QueryTypes.INSERT },
      );
      res.json({ ok: true, scope: 'all' });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  },

  clearSessionInvalidation: async (req: Request, res: Response) => {
    const phone = decodeURIComponent(req.params.phone ?? '');
    try {
      await sequelize.query(
        `DELETE FROM session_invalidation WHERE phone = :phone`,
        { replacements: { phone }, type: QueryTypes.DELETE },
      );
      res.json({ ok: true, phone });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  },
};
