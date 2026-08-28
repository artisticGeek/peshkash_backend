import { Router } from 'express';
import { AnalyticsController } from '../controllers/AnalyticsController';
import { requireRole } from '../middleware/authMiddleware';

const analyticsRouter = Router();

// Read endpoints — require a verified admin or vendor session
analyticsRouter.get('/summary',                  requireRole('admin', 'vendor'), AnalyticsController.getSummary);
analyticsRouter.get('/event-log',                requireRole('admin', 'vendor'), AnalyticsController.getEventLog);
analyticsRouter.get('/events/:eventId/items',    requireRole('admin', 'vendor'), AnalyticsController.getEventItemsBreakdown);
analyticsRouter.get('/events/:eventId/catalog',  requireRole('admin', 'vendor'), AnalyticsController.getEventCatalog);
analyticsRouter.get('/events/:eventId',          requireRole('admin', 'vendor'), AnalyticsController.getEventAnalytics);
analyticsRouter.get('/items',                    requireRole('admin', 'vendor'), AnalyticsController.getTopItems);
analyticsRouter.get('/items/:itemId',            requireRole('admin', 'vendor'), AnalyticsController.getItemAnalytics);
analyticsRouter.get('/events-leaderboard',       requireRole('admin', 'vendor'), AnalyticsController.getEventLeaderboard);
analyticsRouter.get('/event-log',                requireRole('admin', 'vendor'), AnalyticsController.getEventLog);

// Raw export — enriched JSON for one vendor's events; vendor scoping inside handler
analyticsRouter.get('/export/vendor/:vendorId', requireRole('admin', 'vendor'), AnalyticsController.exportVendorRaw);

// Write endpoint — public (customers fire this from menu/item pages, no token)
analyticsRouter.post('/action', AnalyticsController.recordAction);

export default analyticsRouter;
