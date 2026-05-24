import { Op } from 'sequelize';
import { Event } from '../models/event.model';
import { EventMenuMapping } from '../models/eventMenuMapping.model';
import { LineItem } from '../models/lineItem.model';
import { Menu } from '../models/menu.model';
import { Vendor } from '../models/vendor.model';
import { VendorPricingConfig } from '../models/vendorPricingConfig.model';
import { CreateEventDTO, CreateLineItemDTO, CreateMenuDTO, UpdateLineItemDTO, UpdateEventTimingsDTO } from '../models/dto/onboarding.dto';

export const OnboardingRepo = {

  // ─── Vendor ────────────────────────────────────────────────────────────────

  getVendorByName: (name: string) =>
    Vendor.findOne({ where: { name } }),

  // ─── Menus ────────────────────────────────────────────────────────────────

  listMenus: (vendorId: number) =>
    Menu.findAll({
      where: { vendorId },
      attributes: ['id', 'name', 'displayName', 'description', 'isActive', 'createdAt'],
    }),

  createMenu: (vendorId: number, dto: CreateMenuDTO) =>
    Menu.create({ ...dto, vendorId, isActive: true } as any),

  getMenuById: (menuId: number, vendorId: number) =>
    Menu.findOne({ where: { id: menuId, vendorId } }),

  // ─── Line Items ───────────────────────────────────────────────────────────

  getFlatItemsByMenu: (menuId: number) =>
    LineItem.findAll({ where: { menuId } }),

  createLineItem: (menuId: number, dto: Partial<CreateLineItemDTO> & { parentId?: number }) =>
    LineItem.create({
      name: dto.name,
      displayName: dto.displayName,
      description: dto.description,
      ingredients: dto.ingredients,
      image: dto.image,
      type: dto.type,
      enumType: dto.enumType,
      isActive: dto.isActive ?? true,
      menuId,
      parentId: dto.parentId ?? null,
    } as any),

  updateLineItem: (itemId: number, menuId: number, dto: UpdateLineItemDTO) => {
    const updates: Record<string, any> = {};
    if (dto.displayName !== undefined) updates.displayName = dto.displayName;
    if (dto.description !== undefined) updates.description = dto.description;
    if (dto.ingredients !== undefined) updates.ingredients = dto.ingredients;
    if (dto.image !== undefined) updates.image = dto.image;
    if (dto.type !== undefined) updates.type = dto.type;
    if (dto.enumType !== undefined) updates.enumType = dto.enumType;
    if (dto.isActive !== undefined) updates.isActive = dto.isActive;
    if ('parentId' in dto) updates.parentId = dto.parentId ?? null;
    return LineItem.update(updates, { where: { id: itemId, menuId } });
  },

  deleteLineItems: (itemIds: number[], menuId: number) =>
    LineItem.destroy({ where: { id: { [Op.in]: itemIds }, menuId } }),

  // ─── Events ───────────────────────────────────────────────────────────────

  listEvents: (vendorId: number) =>
    Event.findAll({
      where: { vendorId },
      attributes: ['id', 'name', 'displayName', 'eventDescription', 'startTime', 'endTime', 'status', 'amountPaid'],
    }),

  createEvent: (vendorId: number, dto: CreateEventDTO) =>
    Event.create({ ...dto, vendorId, status: 'draft' } as any),

  getEventById: (eventId: number, vendorId: number) =>
    Event.findOne({ where: { id: eventId, vendorId } }),

  updateEventTimings: (eventId: number, dto: UpdateEventTimingsDTO) =>
    Event.update({ startTime: dto.startTime, endTime: dto.endTime }, { where: { id: eventId } }),

  updateEventPayment: (
    eventId: number,
    data: { razorpayOrderId?: string; paymentId?: string; amountPaid?: number; status?: string; startTime?: Date; endTime?: Date }
  ) => Event.update(data, { where: { id: eventId } }),

  // ─── Event-Menu Mapping ───────────────────────────────────────────────────

  linkMenuToEvent: (eventId: number, menuId: number) =>
    EventMenuMapping.findOrCreate({ where: { eventId, menuId }, defaults: { eventId, menuId } as any }),

  unlinkMenuFromEvent: (eventId: number, menuId: number) =>
    EventMenuMapping.destroy({ where: { eventId, menuId } }),

  getEventMenuMappings: (eventId: number) =>
    EventMenuMapping.findAll({ where: { eventId }, include: [{ model: Menu }] }),

  // ─── Pricing ──────────────────────────────────────────────────────────────

  getPricingConfig: (vendorId: number) =>
    VendorPricingConfig.findOne({ where: { vendorId, isActive: true } }),
};
