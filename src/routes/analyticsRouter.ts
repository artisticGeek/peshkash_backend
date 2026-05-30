import { Router } from 'express';
import { AnalyticsController } from '../controllers/AnalyticsController';

const analyticsRouter = Router();

// Read endpoints (admin dashboard)
analyticsRouter.get('/summary', AnalyticsController.getSummary);
analyticsRouter.get('/events/:eventId', AnalyticsController.getEventAnalytics);
analyticsRouter.get('/items', AnalyticsController.getTopItems);
analyticsRouter.get('/items/:itemId', AnalyticsController.getItemAnalytics);
analyticsRouter.get('/events-leaderboard', AnalyticsController.getEventLeaderboard);

// Write endpoint (frontend action tracking, fire-and-forget)
analyticsRouter.post('/action', AnalyticsController.recordAction);

export default analyticsRouter;
