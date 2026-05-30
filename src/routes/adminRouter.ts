import { Router } from 'express';
import { AdminController } from '../controllers/AdminController';
import { AuthController } from '../controllers/AuthController';
import { requireRole } from '../middleware/authMiddleware';

const router = Router();

router.get('/vendors', AdminController.listVendors);
router.post('/vendors', AdminController.createVendor);
router.put('/vendors/:vendorId', AdminController.updateVendor);
router.delete('/vendors/:vendorId', AdminController.deleteVendor);

router.get('/events', AdminController.listEvents);
router.post('/events', AdminController.createEvent);
router.put('/events/:eventId', AdminController.updateEvent);
router.delete('/events/:eventId', AdminController.deleteEvent);
router.patch('/events/:eventId/status', AdminController.setEventStatus);
router.get('/events/:eventId/menus', AdminController.listEventMenus);
router.post('/events/:eventId/menus/:menuId', AdminController.linkMenuToEvent);
router.delete('/events/:eventId/menus/:menuId', AdminController.unlinkMenuFromEvent);

router.get('/menus', AdminController.listMenus);
router.post('/menus', AdminController.createMenu);
router.put('/menus/:menuId', AdminController.updateMenu);
router.delete('/menus/:menuId', AdminController.deleteMenu);
router.post('/menus/:menuId/copy', AdminController.copyMenu);

router.get('/vendors/:vendorId/item-pool', AdminController.getItemPool);

router.get('/items', AdminController.listItems);
router.post('/items', AdminController.createItem);
router.put('/items/:itemId', AdminController.updateItem);
router.delete('/items/:itemId', AdminController.deleteItem);

router.get('/qr-mappings', AdminController.listQrMappings);
router.post('/qr-mappings', AdminController.upsertQrMapping);
router.post('/qr-mappings/for-event/:eventId', AdminController.getOrCreateEventQr);
router.put('/qr-mappings/:id', AdminController.updateQrMapping);
router.delete('/qr-mappings/:id', AdminController.deleteQrMapping);

router.get('/qr-templates', AdminController.listQrTemplates);
router.post('/qr-templates', AdminController.createQrTemplate);
router.put('/qr-templates/:id', AdminController.updateQrTemplate);
router.delete('/qr-templates/:id', AdminController.deleteQrTemplate);

router.get('/previews', AdminController.getPreviews);
router.get('/preview/menu', AdminController.buildMenuPath);
router.get('/preview/item', AdminController.buildItemPath);

// Admin user management — only accessible by admins
router.get('/admin-users',         requireRole('admin'), AuthController.listAdminUsers);
router.post('/admin-users',        requireRole('admin'), AuthController.addAdminUser);
router.delete('/admin-users/:phone', requireRole('admin'), AuthController.removeAdminUser);

export default router;
