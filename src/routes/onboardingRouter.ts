import { Router } from 'express';
import multer from 'multer';
import { OnboardingController } from '../controllers/OnboardingController';

const router = Router({ mergeParams: true }); // inherit :vendorName from parent
const upload = multer({ storage: multer.memoryStorage() });

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
