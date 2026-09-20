import { Router } from 'express';
import { EngagementController } from '../controllers/EngagementController';
import { requireRole, requireSection } from '../middleware/authMiddleware';

const engagementRouter = Router();
engagementRouter.use(requireRole('admin', 'vendor'), requireSection('engagement'));
engagementRouter.get('/overview', EngagementController.overview);
engagementRouter.post('/campaigns', EngagementController.createDraft);
engagementRouter.post('/campaigns/:campaignId/send', EngagementController.sendCampaign);

export default engagementRouter;
