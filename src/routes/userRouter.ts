import { Router } from 'express';
import { requireRole } from '../middleware/authMiddleware';
import { UserHistoryController } from '../controllers/UserHistoryController';
import { UserEventsController } from '../controllers/UserEventsController';

const userRouter = Router();
const signedIn = requireRole('customer', 'vendor', 'admin');

userRouter.get('/history', signedIn, UserHistoryController.getHistory);
userRouter.get('/history/audit', signedIn, UserHistoryController.getAuditHistory);
userRouter.get('/items/:itemId/state', signedIn, UserHistoryController.getItemState);
userRouter.post('/bookmarks/import', signedIn, UserHistoryController.importLocalBookmarks);
// Peshkash 5.0: events in the person's home (registrations, saved, visited, activity)
userRouter.get('/events', signedIn, UserEventsController.overview);
userRouter.get('/events/activity', signedIn, UserEventsController.activity);
userRouter.get('/events/:eventId/state', signedIn, UserEventsController.state);
userRouter.get('/communication-preferences', signedIn, UserHistoryController.getCommunicationPreferences);
userRouter.put('/communication-preferences/:vendorId', signedIn, UserHistoryController.updateCommunicationPreference);
userRouter.get('/communication-settings', signedIn, UserHistoryController.getCommunicationSettings);
userRouter.get('/updates', signedIn, UserHistoryController.getUpdates);
userRouter.put('/communication-settings/:channel', signedIn, UserHistoryController.updateCommunicationSettings);
userRouter.get('/push/config', signedIn, UserHistoryController.getPushConfig);
userRouter.post('/push/subscriptions', signedIn, UserHistoryController.subscribeToPush);
userRouter.delete('/push/subscriptions', signedIn, UserHistoryController.unsubscribeFromPush);
userRouter.delete('/push/subscriptions/:vendorId', signedIn, UserHistoryController.unsubscribeFromPush);

export default userRouter;
