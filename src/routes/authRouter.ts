import { Router } from 'express';
import { AuthController } from '../controllers/AuthController';

const authRouter = Router();

authRouter.post('/send-otp',   AuthController.sendOtp);
authRouter.post('/verify-otp', AuthController.verifyOtp);
authRouter.get('/me',          AuthController.me);

export default authRouter;
