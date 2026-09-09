import { Router } from 'express';
import multer from 'multer';
import { OnboardingController } from '../controllers/OnboardingController';
import { requireRole } from '../middleware/authMiddleware';
import { OnboardingRepo } from '../repositories/onboarding.repository';

const router = Router({ mergeParams: true }); // inherit :vendorName from parent

// Every route below acts on the vendor named in the URL — menus, items, events,
// payments, image upload. Until now nothing checked who was asking: role alone
// isn't enough because :vendorName is attacker-controlled, so any authenticated
// vendor (or, since authMiddleware doesn't reject missing tokens, anyone at all)
// could read or write another vendor's data by changing the URL. Admins act on
// any vendor; a vendor role is confined to the vendor row matching their own
// vendorId from the JWT.
router.use(requireRole('admin', 'vendor'));
router.use(async (req, res, next) => {
  if (req.user!.role === 'admin') { next(); return; }
  const vendor = await OnboardingRepo.getVendorByName(req.params.vendorName);
  if (!vendor || Number(vendor.id) !== Number(req.user!.vendorId)) {
    res.status(403).json({ message: 'Insufficient permissions.' });
    return;
  }
  next();
});
// Matches the 8 MB limit the frontend already advertises to the user (was
// mismatched at 1 MB here, so any real photo between 1-8 MB silently crashed
// the request instead of failing with a clear error).
// No fileFilter here: rejecting an unsupported type by silently dropping the
// file (multer's fileFilter convention) left req.file undefined, which the
// controller then reported as "No file provided" — misleading when a file
// *was* selected. OnboardingService.uploadImage already does a proper
// signature check and throws a specific, accurate error message instead.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
});

// ── Menus ─────────────────────────────────────────────────────────────────────
router.get('/menus', OnboardingController.listMenus);
router.post('/menus', OnboardingController.createMenu);

// ── Line Items ────────────────────────────────────────────────────────────────
router.post('/menus/:menuId/items', OnboardingController.createLineItems);
router.put('/menus/:menuId/items/:itemId', OnboardingController.updateLineItem);
router.delete('/menus/:menuId/items', OnboardingController.deleteLineItems);

// ── Events ────────────────────────────────────────────────────────────────────
router.get('/events', OnboardingController.listEvents);
router.post('/events', OnboardingController.createEvent);
router.put('/events/:eventId', OnboardingController.updateEventTimings);

// ── Event-Menu Mapping ────────────────────────────────────────────────────────
router.post('/events/:eventId/menus/:menuId', OnboardingController.linkMenuToEvent);
router.delete('/events/:eventId/menus/:menuId', OnboardingController.unlinkMenuFromEvent);

// ── Pricing ───────────────────────────────────────────────────────────────────
router.get('/pricing', OnboardingController.getPricingConfig);

// ── Payment ───────────────────────────────────────────────────────────────────
router.post('/events/:eventId/payment/initiate', OnboardingController.initiatePayment);
router.post('/events/:eventId/payment/verify', OnboardingController.verifyPayment);

// ── Image Upload ──────────────────────────────────────────────────────────────
router.post('/upload', upload.single('image'), OnboardingController.uploadImage);

export default router;
