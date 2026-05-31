import { Router } from 'express';
import { AnalyticsController } from '../controllers/AnalyticsController';
import { requireRole } from '../middleware/authMiddleware';

const analyticsRouter = Router();

// Read endpoints — require a verified admin or vendor session
analyticsRouter.get('/summary',                  requireRole('admin', 'vendor'), AnalyticsController.getSummary);
analyticsRouter.get('/events/:eventId/items',    requireRole('admin', 'vendor'), AnalyticsController.getEventItemsBreakdown);
analyticsRouter.get('/events/:eventId',          requireRole('admin', 'vendor'), AnalyticsController.getEventAnalytics);
analyticsRouter.get('/items',                    requireRole('admin', 'vendor'), AnalyticsController.getTopItems);
analyticsRouter.get('/items/:itemId',            requireRole('admin', 'vendor'), AnalyticsController.getItemAnalytics);
analyticsRouter.get('/events-leaderboard',       requireRole('admin', 'vendor'), AnalyticsController.getEventLeaderboard);

// Write endpoint — public (customers fire this from menu/item pages, no token)
analyticsRouter.post('/action', AnalyticsController.recordAction);

export default analyticsRouter;
