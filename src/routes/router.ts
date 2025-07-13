import { Router } from 'express';
import { QrMappingController } from '../controllers/QrCodeController';

const router = Router();

// Your new nested event-menu route
//router.get('/event/:eventId/menu/:menuId', QrMappingController.getMenuByEventId);

router.get('/event/:eventName/menu/:menuName', QrMappingController.getMenuByEventAndMenuName);

router.get('/event/:eventName/menu/:menuName/item/:itemName', QrMappingController.getDishDetails);

export default router;
