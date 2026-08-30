import crypto from 'crypto';
import Razorpay from 'razorpay';
import { createClient } from '@supabase/supabase-js';
import { OnboardingRepo } from '../repositories/onboarding.repository';
import {
  CreateLineItemDTO,
  InitiatePaymentDTO,
  VerifyPaymentDTO,
  MenuSummaryDTO,
  FlatLineItemDTO,
  EventSummaryWithStatusDTO,
  VendorPricingConfigDTO,
} from '../models/dto/onboarding.dto';

// ─── Clients (lazy-initialised so missing env vars fail at call time, not boot) ─

function getRazorpay() {
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID!,
    key_secret: process.env.RAZORPAY_KEY_SECRET!,
  });
}

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );
}

const IMAGE_BUCKET = 'item-images';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toMenuSummary(menu: any): MenuSummaryDTO {
  return {
    id: menu.id,
    name: menu.name,
    displayName: menu.displayName,
    description: menu.description,
    itemStoryHeading: menu.itemStoryHeading || 'The backstory',
    isActive: menu.isActive,
    createdAt: menu.createdAt,
  };
}

function toFlatItem(item: any): FlatLineItemDTO {
  return {
    id: item.id,
    name: item.name,
    displayName: item.displayName,
    description: item.description,
    ingredients: item.ingredients,
    image: item.image,
    type: item.type,
    enumType: item.enumType,
    isActive: item.isActive,
    parentId: item.parentId ?? undefined,
    menuId: item.menuId,
    createdAt: item.createdAt,
  };
}

function toEventSummary(event: any): EventSummaryWithStatusDTO {
  return {
    id: event.id,
    name: event.name,
    displayName: event.displayName,
    eventDescription: event.eventDescription,
    startTime: event.startTime,
    endTime: event.endTime,
    status: event.status,
    amountPaid: event.amountPaid,
  };
}

function toPricingDTO(config: any): VendorPricingConfigDTO {
  return {
    id: config.id,
    modelType: config.modelType,
    amount: config.amount,
    currency: config.currency,
    notes: config.notes,
  };
}

// ─── Service ─────────────────────────────────────────────────────────────────

export const OnboardingService = {

  // ── Vendor validation ──────────────────────────────────────────────────────

  getVendorOrThrow: async (vendorName: string) => {
    const vendor = await OnboardingRepo.getVendorByName(vendorName);
    if (!vendor) throw Object.assign(new Error('Vendor not found'), { status: 404 });
    return vendor;
  },

  // ── Menus ──────────────────────────────────────────────────────────────────

  listMenus: async (vendorName: string): Promise<MenuSummaryDTO[]> => {
    const vendor = await OnboardingService.getVendorOrThrow(vendorName);
    const menus = await OnboardingRepo.listMenus(vendor.id);
    return menus.map(toMenuSummary);
  },

  createMenu: async (vendorName: string, dto: { name: string; displayName: string; description?: string }): Promise<MenuSummaryDTO> => {
    const vendor = await OnboardingService.getVendorOrThrow(vendorName);
    const menu = await OnboardingRepo.createMenu(vendor.id, dto);
    return toMenuSummary(menu);
  },

  // ── Line Items (batch) ─────────────────────────────────────────────────────

  /**
   * Creates multiple items at once. Supports nesting within the same batch
   * via tempId / parentTempId. Items referencing an existing parent use parentId directly.
   *
   * Processing order: items without a parentTempId (roots) first, then children,
   * resolved by building a tempId → db id map.
   */
  createLineItemsBatch: async (
    vendorName: string,
    menuId: number,
    items: CreateLineItemDTO[]
  ): Promise<FlatLineItemDTO[]> => {
    const vendor = await OnboardingService.getVendorOrThrow(vendorName);
    await OnboardingRepo.getMenuById(menuId, vendor.id).then(m => {
      if (!m) throw Object.assign(new Error('Menu not found'), { status: 404 });
    });

    // topological sort: roots first (no parentTempId), then children
    const tempIdToDbId = new Map<string, number>();
    const sorted: CreateLineItemDTO[] = [];
    const remaining = [...items];

    let pass = 0;
    while (remaining.length > 0 && pass < items.length + 1) {
      pass++;
      const stillRemaining: CreateLineItemDTO[] = [];
      for (const item of remaining) {
        if (!item.parentTempId || tempIdToDbId.has(item.parentTempId) || item.parentId) {
          sorted.push(item);
        } else {
          stillRemaining.push(item);
        }
      }
      remaining.splice(0, remaining.length, ...stillRemaining);
    }
    if (remaining.length > 0) throw new Error('Circular or unresolvable parentTempId references');

    const created: FlatLineItemDTO[] = [];
    for (const item of sorted) {
      const resolvedParentId =
        item.parentId ??
        (item.parentTempId ? tempIdToDbId.get(item.parentTempId) : undefined);

      const record = await OnboardingRepo.createLineItem(menuId, { ...item, parentId: resolvedParentId });
      if (item.tempId) tempIdToDbId.set(item.tempId, record.id);
      created.push(toFlatItem(record));
    }
    return created;
  },

  updateLineItem: async (vendorName: string, menuId: number, itemId: number, dto: any): Promise<void> => {
    const vendor = await OnboardingService.getVendorOrThrow(vendorName);
    const menu = await OnboardingRepo.getMenuById(menuId, vendor.id);
    if (!menu) throw Object.assign(new Error('Menu not found'), { status: 404 });
    await OnboardingRepo.updateLineItem(itemId, menuId, dto);
  },

  deleteLineItems: async (vendorName: string, menuId: number, itemIds: number[]): Promise<void> => {
    const vendor = await OnboardingService.getVendorOrThrow(vendorName);
    const menu = await OnboardingRepo.getMenuById(menuId, vendor.id);
    if (!menu) throw Object.assign(new Error('Menu not found'), { status: 404 });
    await OnboardingRepo.deleteLineItems(itemIds, menuId);
  },

  // ── Events ────────────────────────────────────────────────────────────────

  listEvents: async (vendorName: string): Promise<EventSummaryWithStatusDTO[]> => {
    const vendor = await OnboardingService.getVendorOrThrow(vendorName);
    const events = await OnboardingRepo.listEvents(vendor.id);
    return events.map(toEventSummary);
  },

  createEvent: async (vendorName: string, dto: { name: string; displayName: string; eventDescription?: string }): Promise<EventSummaryWithStatusDTO> => {
    const vendor = await OnboardingService.getVendorOrThrow(vendorName);
    const event = await OnboardingRepo.createEvent(vendor.id, dto);
    return toEventSummary(event);
  },

  updateEventTimings: async (vendorName: string, eventId: number, dto: { startTime: Date; endTime: Date }): Promise<void> => {
    const vendor = await OnboardingService.getVendorOrThrow(vendorName);
    const event = await OnboardingRepo.getEventById(eventId, vendor.id);
    if (!event) throw Object.assign(new Error('Event not found'), { status: 404 });
    await OnboardingRepo.updateEventTimings(eventId, dto);
  },

  // ── Event-Menu mapping ────────────────────────────────────────────────────

  linkMenuToEvent: async (vendorName: string, eventId: number, menuId: number) => {
    const vendor = await OnboardingService.getVendorOrThrow(vendorName);
    const [event, menu] = await Promise.all([
      OnboardingRepo.getEventById(eventId, vendor.id),
      OnboardingRepo.getMenuById(menuId, vendor.id),
    ]);
    if (!event) throw Object.assign(new Error('Event not found'), { status: 404 });
    if (!menu) throw Object.assign(new Error('Menu not found'), { status: 404 });
    await OnboardingRepo.linkMenuToEvent(eventId, menuId);
  },

  unlinkMenuFromEvent: async (vendorName: string, eventId: number, menuId: number) => {
    const vendor = await OnboardingService.getVendorOrThrow(vendorName);
    await OnboardingRepo.unlinkMenuFromEvent(eventId, menuId);
  },

  // ── Pricing ───────────────────────────────────────────────────────────────

  getPricingConfig: async (vendorName: string): Promise<VendorPricingConfigDTO | null> => {
    const vendor = await OnboardingService.getVendorOrThrow(vendorName);
    const config = await OnboardingRepo.getPricingConfig(vendor.id);
    return config ? toPricingDTO(config) : null;
  },

  // ── Razorpay Payment ──────────────────────────────────────────────────────

  initiatePayment: async (vendorName: string, eventId: number, dto: InitiatePaymentDTO) => {
    const vendor = await OnboardingService.getVendorOrThrow(vendorName);
    const [event, pricing] = await Promise.all([
      OnboardingRepo.getEventById(eventId, vendor.id),
      OnboardingRepo.getPricingConfig(vendor.id),
    ]);
    if (!event) throw Object.assign(new Error('Event not found'), { status: 404 });
    if (!pricing || !pricing.amount) throw Object.assign(new Error('No active pricing config with amount found'), { status: 400 });

    const amountInPaise = Math.round(Number(pricing.amount) * 100);
    const order = await getRazorpay().orders.create({
      amount: amountInPaise,
      currency: pricing.currency,
      receipt: `event_${eventId}_vendor_${vendor.id}`,
    });

    const startTime = new Date(dto.startTime);
    const endTime = new Date(startTime.getTime() + dto.durationHours * 60 * 60 * 1000);

    await OnboardingRepo.updateEventPayment(eventId, {
      razorpayOrderId: order.id,
      startTime,
      endTime,
    });

    return {
      orderId: order.id,
      amount: amountInPaise,
      currency: pricing.currency,
      keyId: process.env.RAZORPAY_KEY_ID!,
    };
  },

  verifyPayment: async (vendorName: string, eventId: number, dto: VerifyPaymentDTO) => {
    const vendor = await OnboardingService.getVendorOrThrow(vendorName);
    const event = await OnboardingRepo.getEventById(eventId, vendor.id);
    if (!event) throw Object.assign(new Error('Event not found'), { status: 404 });

    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
      .update(`${dto.razorpayOrderId}|${dto.razorpayPaymentId}`)
      .digest('hex');

    if (expectedSignature !== dto.razorpaySignature) {
      throw Object.assign(new Error('Payment signature verification failed'), { status: 400 });
    }

    const pricing = await OnboardingRepo.getPricingConfig(vendor.id);
    await OnboardingRepo.updateEventPayment(eventId, {
      paymentId: dto.razorpayPaymentId,
      status: 'active',
      amountPaid: pricing?.amount,
    });

    return { success: true, eventId };
  },

  // ── Image Upload ──────────────────────────────────────────────────────────

  uploadImage: async (vendorName: string, file: Express.Multer.File): Promise<string> => {
    await OnboardingService.getVendorOrThrow(vendorName);

    const ext = file.originalname.split('.').pop();
    const fileName = `${vendorName}/${Date.now()}.${ext}`;
    const supabase = getSupabase();

    const { error } = await supabase.storage
      .from(IMAGE_BUCKET)
      .upload(fileName, file.buffer, { contentType: file.mimetype, upsert: false });

    if (error) throw Object.assign(new Error(`Image upload failed: ${error.message}`), { status: 500 });

    const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(fileName);
    return data.publicUrl;
  },
};
