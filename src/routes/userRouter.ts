import { Router } from 'express';
import { requireRole } from '../middleware/authMiddleware';
import { UserHistoryController } from '../controllers/UserHistoryController';

const userRouter = Router();
const signedIn = requireRole('customer', 'vendor', 'admin');

userRouter.get('/history', signedIn, UserHistoryController.getHistory);
userRouter.get('/history/audit', signedIn, UserHistoryController.getAuditHistory);
userRouter.get('/items/:itemId/state', signedIn, UserHistoryController.getItemState);
userRouter.post('/bookmarks/import', signedIn, UserHistoryController.importLocalBookmarks);
userRouter.get('/communication-preferences', signedIn, UserHistoryController.getCommunicationPreferences);
userRouter.put('/communication-preferences/:vendorId', signedIn, UserHistoryController.updateCommunicationPreference);
userRouter.get('/communication-settings', signedIn, UserHistoryController.getCommunicationSettings);
userRouter.put('/communication-settings/:channel', signedIn, UserHistoryController.updateCommunicationSettings);
userRouter.get('/push/config', signedIn, UserHistoryController.getPushConfig);
userRouter.post('/push/subscriptions', signedIn, UserHistoryController.subscribeToPush);
userRouter.delete('/push/subscriptions', signedIn, UserHistoryController.unsubscribeFromPush);
userRouter.delete('/push/subscriptions/:vendorId', signedIn, UserHistoryController.unsubscribeFromPush);

export default userRouter;
