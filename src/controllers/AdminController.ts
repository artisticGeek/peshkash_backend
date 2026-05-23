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
    handle(res, AdminService.linkMenuToEvent(Number(req.params.eventId), Number(req.params.menuId)), 201),
  unlinkMenuFromEvent: (req: Request, res: Response) =>
    handle(res, AdminService.unlinkMenuFromEvent(Number(req.params.eventId), Number(req.params.menuId))),

  listItems: (req: Request, res: Response) =>
    handle(res, AdminService.listItems(req.query.menuId ? Number(req.query.menuId) : undefined)),
  createItem: (req: Request, res: Response) => handle(res, AdminService.createItem(req.body), 201),
  updateItem: (req: Request, res: Response) =>
    handle(res, AdminService.updateItem(Number(req.params.itemId), req.body)),

  listQrMappings: (req: Request, res: Response) =>
    handle(res, AdminService.listQrMappings({ origin: getOrigin(req) })),
  upsertQrMapping: (req: Request, res: Response) =>
    handle(res, AdminService.upsertQrMapping(req.body, { origin: getOrigin(req) }), 201),

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
