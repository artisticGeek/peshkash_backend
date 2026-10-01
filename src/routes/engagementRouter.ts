import { Router } from 'express';
import { EngagementController } from '../controllers/EngagementController';
import { requireRole, requireSection, requireVendorAccess } from '../middleware/authMiddleware';

const engagementRouter = Router();
engagementRouter.use(requireRole('admin', 'vendor'), requireSection('engagement'));
engagementRouter.use(requireVendorAccess({ vendor: 'query' }));
engagementRouter.get('/overview', EngagementController.overview);
engagementRouter.get('/audience', EngagementController.audiencePreview);
engagementRouter.get('/recipients', EngagementController.recipientDirectory);
engagementRouter.post('/audience/eligible-recipient', EngagementController.checkEligibleRecipient);
engagementRouter.post('/campaigns', EngagementController.createDraft);
engagementRouter.patch('/campaigns/:campaignId', EngagementController.updateCampaign);
engagementRouter.get('/campaigns/:campaignId/recipients', EngagementController.campaignRecipients);
engagementRouter.post('/campaigns/:campaignId/send', EngagementController.sendCampaign);

export default engagementRouter;
