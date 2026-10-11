import { Router } from 'express';
import multer from 'multer';
import { requireRole, requireSection, requireVendorAccess } from '../middleware/authMiddleware';
import { CheckInController, RegistrationAdminController, RegistrationPublicController } from '../controllers/EventRegistrationController';
import { rateLimit } from '../utils/RateLimitUtil';

const anyone = requireRole('customer', 'vendor', 'admin');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });

/** /api/registration — guest side of Peshkash 5.0 event registration. */
export const registrationRouter = Router();
registrationRouter.get('/pass/:token', rateLimit('pass', 60, 60_000), RegistrationPublicController.pass);
registrationRouter.get('/invite/:token', rateLimit('invite', 30, 60_000), RegistrationPublicController.invite);
registrationRouter.get('/:eventName', rateLimit('reg-context', 120, 60_000), RegistrationPublicController.context);
registrationRouter.post('/:eventName', anyone, rateLimit('register', 10, 60_000, 'phone'), RegistrationPublicController.register);
registrationRouter.post('/:eventName/cancel', anyone, rateLimit('register', 10, 60_000, 'phone'), RegistrationPublicController.cancel);
registrationRouter.post('/:eventName/feedback', anyone, rateLimit('feedback', 10, 60_000, 'phone'), RegistrationPublicController.feedback);
registrationRouter.post('/:eventName/uploads', anyone, rateLimit('reg-upload', 20, 60_000, 'phone'), upload.single('file'), RegistrationPublicController.upload);

/** /api/admin/event-registration/:eventId — vendor workspace. */
export const registrationAdminRouter = Router({ mergeParams: true });
registrationAdminRouter.use(requireRole('admin', 'vendor'), requireSection('events'), requireVendorAccess({ event: 'params' }));
registrationAdminRouter.get('/', RegistrationAdminController.overview);
registrationAdminRouter.put('/settings', RegistrationAdminController.saveSettings);
registrationAdminRouter.put('/forms/:kind', RegistrationAdminController.saveForm);
registrationAdminRouter.get('/registrations', RegistrationAdminController.list);
registrationAdminRouter.post('/registrations/actions', RegistrationAdminController.action);
registrationAdminRouter.post('/registrations/notify', RegistrationAdminController.notify);
registrationAdminRouter.get('/view', RegistrationAdminController.view);
registrationAdminRouter.put('/view', RegistrationAdminController.saveView);
registrationAdminRouter.get('/invites', RegistrationAdminController.invites);
registrationAdminRouter.post('/invites', RegistrationAdminController.createInvites);
registrationAdminRouter.delete('/invites/:inviteId', RegistrationAdminController.revokeInvite);
registrationAdminRouter.post('/feedback/send', RegistrationAdminController.sendFeedback);
registrationAdminRouter.get('/files', RegistrationAdminController.file);

/** /api/checkin/:eventId — door check-in for vendor admins and the event's door staff. */
export const checkInRouter = Router({ mergeParams: true });
checkInRouter.use(anyone);
checkInRouter.get('/', CheckInController.access);
checkInRouter.post('/scan', rateLimit('scan', 120, 60_000, 'phone'), CheckInController.scan);
checkInRouter.get('/search', rateLimit('scan-search', 120, 60_000, 'phone'), CheckInController.search);
checkInRouter.post('/manual', rateLimit('scan', 120, 60_000, 'phone'), CheckInController.manual);
