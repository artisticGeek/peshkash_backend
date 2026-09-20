import { Router } from 'express';
import { AdminController } from '../controllers/AdminController';
import { AuthController } from '../controllers/AuthController';
import { requireRole, requireSection } from '../middleware/authMiddleware';

const router = Router();

// ── Auth gate — every admin route requires a verified admin or vendor session ──
// (sub-routes below add their own stricter requireRole('admin')/requireSection(...) guards)
router.use(requireRole('admin', 'vendor'));

router.get('/vendors', requireSection('vendors'), AdminController.listVendors);
router.post('/vendors', requireSection('vendors'), AdminController.createVendor);
router.put('/vendors/:vendorId', requireSection('vendors'), AdminController.updateVendor);
router.delete('/vendors/:vendorId', requireSection('vendors'), AdminController.deleteVendor);

router.get('/events', requireSection('events'), AdminController.listEvents);
router.post('/events', requireSection('events'), AdminController.createEvent);
router.put('/events/:eventId', requireSection('events'), AdminController.updateEvent);
router.patch('/events/:eventId/experience', requireSection('events'), AdminController.updateEventExperience);
router.delete('/events/:eventId', requireSection('events'), AdminController.deleteEvent);
router.patch('/events/:eventId/status', requireSection('events'), AdminController.setEventStatus);
router.get('/events/:eventId/menus', requireSection('events'), AdminController.listEventMenus);
router.get('/events/:eventId/registrations', requireSection('events'), AdminController.listEventRegistrations);
router.post('/events/:eventId/menus/:menuId', requireSection('events'), AdminController.linkMenuToEvent);
router.delete('/events/:eventId/menus/:menuId', requireSection('events'), AdminController.unlinkMenuFromEvent);

router.get('/menus', requireSection('designer'), AdminController.listMenus);
router.post('/menus', requireSection('designer'), AdminController.createMenu);
router.put('/menus/:menuId', requireSection('designer'), AdminController.updateMenu);
router.delete('/menus/:menuId', requireSection('designer'), AdminController.deleteMenu);
router.post('/menus/:menuId/copy', requireSection('designer'), AdminController.copyMenu);

router.get('/vendors/:vendorId/item-pool', requireSection('designer'), AdminController.getItemPool);

router.get('/items', requireSection('designer'), AdminController.listItems);
router.post('/items', requireSection('designer'), AdminController.createItem);
router.put('/items/:itemId', requireSection('designer'), AdminController.updateItem);
router.delete('/items/:itemId', requireSection('designer'), AdminController.deleteItem);

router.get('/qr-mappings', requireSection('qr'), AdminController.listQrMappings);
router.post('/qr-mappings', requireSection('qr'), AdminController.upsertQrMapping);
router.post('/qr-mappings/for-event/:eventId', requireSection('qr'), AdminController.getOrCreateEventQr);
router.put('/qr-mappings/:id', requireSection('qr'), AdminController.updateQrMapping);
router.delete('/qr-mappings/:id', requireSection('qr'), AdminController.deleteQrMapping);

router.get('/qr-templates', requireSection('qr-templates'), AdminController.listQrTemplates);
router.post('/qr-templates', requireSection('qr-templates'), AdminController.createQrTemplate);
router.put('/qr-templates/:id', requireSection('qr-templates'), AdminController.updateQrTemplate);
router.delete('/qr-templates/:id', requireSection('qr-templates'), AdminController.deleteQrTemplate);

// Design Studio API. These routes use the same persistence during the migration away from the
// legacy QR-template element array, so QR Bank and Studio cannot drift into separate systems.
router.get('/designs', requireSection('qr-templates'), AdminController.listQrTemplates);
router.post('/designs', requireSection('qr-templates'), AdminController.createQrTemplate);
router.get('/designs/:id', requireSection('qr-templates'), AdminController.getQrTemplate);
router.put('/designs/:id', requireSection('qr-templates'), AdminController.updateQrTemplate);
router.post('/designs/:id/duplicate', requireSection('qr-templates'), AdminController.duplicateQrTemplate);
router.post('/designs/:id/validate', requireSection('qr-templates'), AdminController.validateQrTemplate);
router.delete('/designs/:id', requireSection('qr-templates'), AdminController.deleteQrTemplate);

// Cross-cutting helper endpoints for content the caller already has edit access to —
// not gated as their own section.
router.get('/previews', AdminController.getPreviews);
router.get('/preview/menu', AdminController.buildMenuPath);
router.get('/preview/item', AdminController.buildItemPath);

// Admin user management + section grants — bundled under the 'sessions' (security) section
router.get('/admin-users',           requireRole('admin'), requireSection('sessions'), AuthController.listAdminUsers);
router.post('/admin-users',          requireRole('admin'), requireSection('sessions'), AuthController.addAdminUser);
router.delete('/admin-users/:phone', requireRole('admin'), requireSection('sessions'), AuthController.removeAdminUser);
router.get('/section-grants',        requireRole('admin'), requireSection('sessions'), AuthController.listSectionGrants);
router.put('/section-grants',        requireRole('admin'), requireSection('sessions'), AuthController.setSectionGrants);

// Session invalidation — force specific users or everyone to re-authenticate
router.get('/session/invalidations',           requireRole('admin'), requireSection('sessions'), AdminController.listSessionInvalidations);
router.post('/session/force-logout',           requireRole('admin'), requireSection('sessions'), AdminController.forceLogout);
router.post('/session/force-logout-all',       requireRole('admin'), requireSection('sessions'), AdminController.forceLogoutAll);
router.delete('/session/invalidations/:phone', requireRole('admin'), requireSection('sessions'), AdminController.clearSessionInvalidation);

export default router;
