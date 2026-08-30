import { Router } from 'express';
import { QrMappingController } from '../controllers/QrCodeController';
import { EventExperienceController } from '../controllers/EventExperienceController';
import { requireRole } from '../middleware/authMiddleware';

const router = Router();

router.get('/event/:eventName', EventExperienceController.getPublicEvent);
router.post('/event/:eventName/register', requireRole('customer', 'vendor', 'admin'), EventExperienceController.register);

// Your new nested event-menu route
//router.get('/event/:eventId/menu/:menuId', QrMappingController.getMenuByEventId);

router.get('/event/:eventName/menu/:menuName', QrMappingController.getMenuByEventAndMenuName);

router.get('/event/:eventName/menu/:menuName/item/:itemName', QrMappingController.getDishDetails);

router.get('/details/:qrHash', QrMappingController.redirectByQrHash);

// Vendor contact card route
router.get('/vendor/:vendorName', QrMappingController.getVendorCard);

export default router;
