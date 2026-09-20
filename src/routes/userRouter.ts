import { Router } from 'express';
import { requireRole } from '../middleware/authMiddleware';
import { UserHistoryController } from '../controllers/UserHistoryController';

const userRouter = Router();
const signedIn = requireRole('customer', 'vendor', 'admin');

userRouter.get('/history', signedIn, UserHistoryController.getHistory);
userRouter.get('/history/audit', signedIn, UserHistoryController.getAuditHistory);
userRouter.get('/items/:itemId/state', signedIn, UserHistoryController.getItemState);
userRouter.post('/bookmarks/import', signedIn, UserHistoryController.importLocalBookmarks);

export default userRouter;
