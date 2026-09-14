import { Router } from 'express';
import { AnalyticsController } from '../controllers/AnalyticsController';
import { requireRole, requireSection } from '../middleware/authMiddleware';

const analyticsRouter = Router();

// Read endpoints — require a verified admin or vendor session, admin additionally
// needs the 'insights' section grant (vendor bypasses — scoped by vendorId instead)
analyticsRouter.get('/summary',                  requireRole('admin', 'vendor'), requireSection('insights'), AnalyticsController.getSummary);
analyticsRouter.get('/event-log',                requireRole('admin', 'vendor'), requireSection('insights'), AnalyticsController.getEventLog);
analyticsRouter.get('/events/:eventId/items',    requireRole('admin', 'vendor'), requireSection('insights'), AnalyticsController.getEventItemsBreakdown);
analyticsRouter.get('/events/:eventId/catalog',  requireRole('admin', 'vendor'), requireSection('insights'), AnalyticsController.getEventCatalog);
analyticsRouter.get('/events/:eventId',          requireRole('admin', 'vendor'), requireSection('insights'), AnalyticsController.getEventAnalytics);
analyticsRouter.get('/items',                    requireRole('admin', 'vendor'), requireSection('insights'), AnalyticsController.getTopItems);
analyticsRouter.get('/items/:itemId',            requireRole('admin', 'vendor'), requireSection('insights'), AnalyticsController.getItemAnalytics);
analyticsRouter.get('/events-leaderboard',       requireRole('admin', 'vendor'), requireSection('insights'), AnalyticsController.getEventLeaderboard);

// Raw export — enriched JSON for one vendor's events; vendor scoping inside handler
analyticsRouter.get('/export/vendor/:vendorId', requireRole('admin', 'vendor'), requireSection('insights'), AnalyticsController.exportVendorRaw);

// Write endpoint — public (customers fire this from menu/item pages, no token)
analyticsRouter.post('/action', AnalyticsController.recordAction);

export default analyticsRouter;
