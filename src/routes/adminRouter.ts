import { Router } from 'express';
import { AdminController } from '../controllers/AdminController';

const router = Router();

router.get('/vendors', AdminController.listVendors);
router.post('/vendors', AdminController.createVendor);
router.put('/vendors/:vendorId', AdminController.updateVendor);

router.get('/events', AdminController.listEvents);
router.post('/events', AdminController.createEvent);
router.put('/events/:eventId', AdminController.updateEvent);
router.get('/events/:eventId/menus', AdminController.listEventMenus);
router.post('/events/:eventId/menus/:menuId', AdminController.linkMenuToEvent);
router.delete('/events/:eventId/menus/:menuId', AdminController.unlinkMenuFromEvent);

router.get('/menus', AdminController.listMenus);
router.post('/menus', AdminController.createMenu);
router.put('/menus/:menuId', AdminController.updateMenu);

router.get('/items', AdminController.listItems);
router.post('/items', AdminController.createItem);
router.put('/items/:itemId', AdminController.updateItem);

router.get('/qr-mappings', AdminController.listQrMappings);
router.post('/qr-mappings', AdminController.upsertQrMapping);

router.get('/previews', AdminController.getPreviews);
router.get('/preview/menu', AdminController.buildMenuPath);
router.get('/preview/item', AdminController.buildItemPath);

export default router;
