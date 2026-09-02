import { Router } from 'express';
import { QrMappingController } from '../controllers/QrCodeController';
import { EventExperienceController } from '../controllers/EventExperienceController';
import { requireRole } from '../middleware/authMiddleware';
import { SharePreviewController } from '../controllers/SharePreviewController';
import { SocialPreviewImageController } from '../controllers/SocialPreviewImageController';
import { InstagramAvatarController } from '../controllers/InstagramAvatarController';

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
router.get('/instagram-avatar/:username', InstagramAvatarController.get);

// Social-crawler friendly public links. Each endpoint renders Open Graph/Twitter
// metadata, then forwards human visitors to the canonical Peshkash page.
router.get('/share', SharePreviewController.home);
router.get('/share/home', SharePreviewController.home);
router.get('/share/exhibits', SharePreviewController.exhibits);
router.get('/share/vendor/:vendorName', SharePreviewController.vendor);
router.get('/share/event/:eventName/menu/:menuName/item/:itemName', SharePreviewController.item);
router.get('/share/event/:eventName/menu/:menuName', SharePreviewController.menu);
router.get('/share/event/:eventName', SharePreviewController.event);
router.get('/social-previews/event/:eventName/v:version.jpg', SocialPreviewImageController.event);
router.get('/social-previews/vendor/:vendorName/v:version.jpg', SocialPreviewImageController.vendor);
router.get('/social-previews/event/:eventName/menu/:menuName/v:version.jpg', SocialPreviewImageController.menu);
router.get('/social-previews/event/:eventName/menu/:menuName/item/:itemName/v:version.jpg', SocialPreviewImageController.item);

export default router;
