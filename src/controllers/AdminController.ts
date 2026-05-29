import { Request, Response } from 'express';
import { AdminService } from '../services/AdminService';

function getOrigin(req: Request) {
  return process.env.PUBLIC_APP_URL || req.get('origin') || `${req.protocol}://${req.get('host')}`;
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

  listMenus: (_req: Request, res: Response) => handle(res, AdminService.listMenus()),
  createMenu: (req: Request, res: Response) => handle(res, AdminService.createMenu(req.body), 201),
  updateMenu: (req: Request, res: Response) =>
    handle(res, AdminService.updateMenu(Number(req.params.menuId), req.body)),

  listEventMenus: (req: Request, res: Response) =>
    handle(res, AdminService.listEventMenus(Number(req.params.eventId))),
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

  listQrTemplates: (_req: Request, res: Response) => handle(res, AdminService.listQrTemplates()),
  createQrTemplate: (req: Request, res: Response) => handle(res, AdminService.createQrTemplate(req.body), 201),
  updateQrTemplate: (req: Request, res: Response) =>
    handle(res, AdminService.updateQrTemplate(Number(req.params.id), req.body)),
  deleteQrTemplate: (req: Request, res: Response) =>
    handle(res, AdminService.deleteQrTemplate(Number(req.params.id))),

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
};
