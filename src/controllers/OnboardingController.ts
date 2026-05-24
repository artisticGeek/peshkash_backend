import { Request, Response } from 'express';
import { OnboardingService } from '../services/OnboardingService';

function handle(res: Response, promise: Promise<any>, status = 200) {
  promise
    .then(data => res.status(status).json(data))
    .catch((err: any) => res.status(err.status ?? 500).json({ message: err.message ?? 'Internal server error' }));
}

export const OnboardingController = {

  // ── Menus ─────────────────────────────────────────────────────────────────

  listMenus: (req: Request, res: Response) =>
    handle(res, OnboardingService.listMenus(req.params.vendorName)),

  createMenu: (req: Request, res: Response) =>
    handle(res, OnboardingService.createMenu(req.params.vendorName, req.body), 201),

  // ── Line Items ────────────────────────────────────────────────────────────

  createLineItems: (req: Request, res: Response) => {
    const items = Array.isArray(req.body) ? req.body : req.body.items;
    handle(
      res,
      OnboardingService.createLineItemsBatch(req.params.vendorName, Number(req.params.menuId), items),
      201
    );
  },

  updateLineItem: (req: Request, res: Response) =>
    handle(
      res,
      OnboardingService.updateLineItem(
        req.params.vendorName,
        Number(req.params.menuId),
        Number(req.params.itemId),
        req.body
      )
    ),

  deleteLineItems: (req: Request, res: Response) => {
    const { itemIds } = req.body as { itemIds: number[] };
    handle(
      res,
      OnboardingService.deleteLineItems(req.params.vendorName, Number(req.params.menuId), itemIds)
    );
  },

  // ── Events ────────────────────────────────────────────────────────────────

  listEvents: (req: Request, res: Response) =>
    handle(res, OnboardingService.listEvents(req.params.vendorName)),

  createEvent: (req: Request, res: Response) =>
    handle(res, OnboardingService.createEvent(req.params.vendorName, req.body), 201),

  updateEventTimings: (req: Request, res: Response) =>
    handle(
      res,
      OnboardingService.updateEventTimings(
        req.params.vendorName,
        Number(req.params.eventId),
        req.body
      )
    ),

  // ── Event-Menu Mapping ────────────────────────────────────────────────────

  linkMenuToEvent: (req: Request, res: Response) =>
    handle(
      res,
      OnboardingService.linkMenuToEvent(
        req.params.vendorName,
        Number(req.params.eventId),
        Number(req.params.menuId)
      ),
      201
    ),

  unlinkMenuFromEvent: (req: Request, res: Response) =>
    handle(
      res,
      OnboardingService.unlinkMenuFromEvent(
        req.params.vendorName,
        Number(req.params.eventId),
        Number(req.params.menuId)
      )
    ),

  // ── Pricing ───────────────────────────────────────────────────────────────

  getPricingConfig: (req: Request, res: Response) =>
    handle(res, OnboardingService.getPricingConfig(req.params.vendorName)),

  // ── Payment ───────────────────────────────────────────────────────────────

  initiatePayment: (req: Request, res: Response) =>
    handle(
      res,
      OnboardingService.initiatePayment(
        req.params.vendorName,
        Number(req.params.eventId),
        req.body
      ),
      201
    ),

  verifyPayment: (req: Request, res: Response) =>
    handle(
      res,
      OnboardingService.verifyPayment(
        req.params.vendorName,
        Number(req.params.eventId),
        req.body
      )
    ),

  // ── Image Upload ──────────────────────────────────────────────────────────

  uploadImage: (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ message: 'No file provided' });
      return;
    }
    handle(res, OnboardingService.uploadImage(req.params.vendorName, req.file), 201);
  },
};
