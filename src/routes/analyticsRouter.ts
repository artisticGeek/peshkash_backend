import { Router } from 'express';
import { AnalyticsController } from '../controllers/AnalyticsController';
import { requireRole, requireSection, requireVendorAccess } from '../middleware/authMiddleware';

const analyticsRouter = Router();

// Read endpoints — admins are unrestricted; vendor sessions additionally need
// the insights grant and are constrained to a live phone-associated workspace.
analyticsRouter.get('/summary',                  requireRole('admin', 'vendor'), requireSection('insights'), requireVendorAccess({ vendor: 'query', vendorRequired: true }), AnalyticsController.getSummary);
analyticsRouter.get('/event-log',                requireRole('admin', 'vendor'), requireSection('insights'), requireVendorAccess({ vendor: 'query', event: 'query', item: 'query' }), AnalyticsController.getEventLog);
analyticsRouter.get('/events/:eventId/items',    requireRole('admin', 'vendor'), requireSection('insights'), requireVendorAccess({ event: 'params' }), AnalyticsController.getEventItemsBreakdown);
analyticsRouter.get('/events/:eventId/catalog',  requireRole('admin', 'vendor'), requireSection('insights'), requireVendorAccess({ event: 'params' }), AnalyticsController.getEventCatalog);
analyticsRouter.get('/events/:eventId',          requireRole('admin', 'vendor'), requireSection('insights'), requireVendorAccess({ event: 'params' }), AnalyticsController.getEventAnalytics);
analyticsRouter.get('/items',                    requireRole('admin', 'vendor'), requireSection('insights'), requireVendorAccess({ vendor: 'query', vendorRequired: true }), AnalyticsController.getTopItems);
analyticsRouter.get('/items/:itemId',            requireRole('admin', 'vendor'), requireSection('insights'), requireVendorAccess({ item: 'params' }), AnalyticsController.getItemAnalytics);
analyticsRouter.get('/events-leaderboard',       requireRole('admin', 'vendor'), requireSection('insights'), requireVendorAccess({ vendor: 'query', vendorRequired: true }), AnalyticsController.getEventLeaderboard);

// Raw export — enriched JSON for one vendor's events; vendor scoping inside handler
analyticsRouter.get('/export/vendor/:vendorId', requireRole('admin', 'vendor'), requireSection('insights'), requireVendorAccess({ vendor: 'params', vendorRequired: true }), AnalyticsController.exportVendorRaw);

// Write endpoint — public (customers fire this from menu/item pages, no token)
analyticsRouter.post('/action', AnalyticsController.recordAction);

export default analyticsRouter;
