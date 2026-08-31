import { Op, QueryTypes, literal } from 'sequelize';
import { sequelize } from '../config/sequelize';
import { Event } from '../models/event.model';
import { EventMenuMapping } from '../models/eventMenuMapping.model';
import { LineItem } from '../models/lineItem.model';
import { Menu } from '../models/menu.model';
import { QrLinkMapping } from '../models/qrLinkMapping.model';
import { QrTemplate } from '../models/qrTemplate.model';
import { Vendor } from '../models/vendor.model';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const QR_LIBRARY_TEMPLATE_IDS = new Set([
  'contact-card-creative', 'contact-card-professional', 'contact-card-maker', 'portfolio-postcard',
  'social-follow-card', 'artist-artwork-tag', 'painter-title-card', 'exhibition-wall-label',
  'gallery-takeaway-card', 'museum-object-label', 'craft-market-tag', 'product-sticker-square',
  'product-sticker-round', 'product-care-card', 'packaging-insert', 'jewellery-authenticity-card',
  'furniture-product-tag', 'baker-box-sticker', 'caterer-menu-card', 'restaurant-table-menu',
  'cafe-counter-plate', 'food-stall-sign', 'salon-booking-card', 'studio-booking-plate',
  'repair-service-tag', 'tutor-class-flyer', 'event-checkin-pass', 'wedding-vendor-card',
  'real-estate-property-card', 'exhibition-entry-card',
]);
const QR_STYLES = new Set(['obsidian-ring', 'porcelain-cameo']);
const QR_THEMES = new Set(['light', 'dark']);
const APPROVED_QR_HOSTS = new Set(
  (process.env.PESHKASH_QR_HOSTS || 'peshkash.app,www.peshkash.app,pksh.in,pksh.example')
    .split(',').map((host) => host.trim().toLowerCase()).filter(Boolean),
);

type StudioActor = { role: string; vendorId?: number | null };

type UrlContext = {
  origin: string;
};

let eventStatusColumn: boolean | null = null;
let eventMenuDisplayNameColumn: boolean | null = null;

async function hasEventStatusColumn() {
  if (eventStatusColumn !== null) return eventStatusColumn;
  const columns = await Event.sequelize!.getQueryInterface().describeTable('event');
  eventStatusColumn = Boolean((columns as Record<string, unknown>).status);
  return eventStatusColumn;
}

async function eventAttributes() {
  const attrs = ['id', 'name', 'eventDescription', 'displayName', 'startTime', 'endTime', 'experienceConfig', 'createdAt', 'vendorId'];
  if (await hasEventStatusColumn()) attrs.push('status');
  return attrs;
}

async function hasEventMenuDisplayNameColumn() {
  if (eventMenuDisplayNameColumn !== null) return eventMenuDisplayNameColumn;
  const rows = await EventMenuMapping.sequelize!.query<{ column_name: string }>(
    `select column_name
       from information_schema.columns
      where table_schema = 'public'
        and table_name = 'event_menu_mapping'
        and column_name = 'display_name'
      limit 1`,
    { type: QueryTypes.SELECT }
  );
  eventMenuDisplayNameColumn = rows.length > 0;
  return eventMenuDisplayNameColumn;
}

async function eventMenuMappingAttributes() {
  const attrs: any[] = ['id', 'eventId', 'menuId', 'createdAt'];
  if (await hasEventMenuDisplayNameColumn()) {
    attrs.push([literal('"display_name"'), 'displayName']);
  }
  return attrs;
}

function mappingDisplayName(mapping: EventMenuMapping) {
  // 'displayName' is not declared on EventMenuMapping because the column is conditionally
  // present (see hasEventMenuDisplayNameColumn). Cast to any so TS doesn't reject it.
  return mapping.getDataValue('displayName' as any) || mapping.menu.displayName;
}

function badRequest(message: string) {
  return Object.assign(new Error(message), { status: 400 });
}

function notFound(message: string) {
  return Object.assign(new Error(message), { status: 404 });
}

function forbidden(message: string) {
  return Object.assign(new Error(message), { status: 403 });
}

function conflict(message: string) {
  return Object.assign(new Error(message), { status: 409 });
}

function isKnownTemplateId(value: string): boolean {
  return QR_LIBRARY_TEMPLATE_IDS.has(value) || /^custom-[a-z0-9-]+$/i.test(value);
}

function actorVendorId(actor?: StudioActor, requested?: unknown): number | null {
  if (actor?.role === 'vendor') {
    const id = Number(actor.vendorId);
    if (!Number.isFinite(id) || id <= 0) throw forbidden('Vendor workspace is missing from this session');
    return id;
  }
  const id = Number(requested);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function assertApprovedDestination(settings: unknown, document?: unknown): void {
  const settingsDestination = settings && typeof settings === 'object'
    ? (settings as Record<string, unknown>).destination
    : undefined;
  const pages = document && typeof document === 'object'
    ? (document as Record<string, any>).pages
    : undefined;
  const documentDestination = Array.isArray(pages) && pages[0]?.copy
    ? pages[0].copy.destination
    : undefined;
  const destination = String(settingsDestination || documentDestination || '').trim();
  if (!destination) return;
  let url: URL;
  try { url = new URL(destination); } catch { throw badRequest('QR destination must be a valid URL'); }
  if (url.protocol !== 'https:') throw badRequest('QR destination must use HTTPS');
  if (!APPROVED_QR_HOSTS.has(url.hostname.toLowerCase())) throw badRequest('QR destination must use an approved Peshkash host');
}

function assertTemplateWritable(template: QrTemplate, actor?: StudioActor): void {
  if (actor?.role !== 'vendor') return;
  if (!template.vendorId || Number(template.vendorId) !== Number(actor.vendorId)) {
    throw forbidden('This design belongs to another workspace or is a protected library preset');
  }
}

function requireSlug(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw badRequest(`${field} is required`);
  }
  const slug = value.trim();
  if (!SLUG_PATTERN.test(slug)) {
    throw badRequest(`${field} must be URL-safe: lowercase letters, numbers, and hyphens only`);
  }
  return slug;
}

function requireText(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw badRequest(`${field} is required`);
  }
  return value.trim();
}

function optionalDate(value: unknown) {
  if (!value) return undefined;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw badRequest('Invalid date value');
  return date;
}

function isStatus(value: unknown) {
  return value === 'draft' || value === 'active' || value === 'inactive';
}

function assertEventWindow(startTime?: Date | null, endTime?: Date | null) {
  if (startTime && endTime && endTime.getTime() <= startTime.getTime()) {
    throw badRequest('Event end time must be after its start time');
  }
}

function cleanExternalUrl(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim().slice(0, 1000) : '';
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return ['https:', 'http:'].includes(url.protocol) ? url.toString() : '';
  } catch { return ''; }
}

function cleanEventExperience(value: unknown) {
  const input = value && typeof value === 'object' ? value as Record<string, any> : {};
  const guests = Array.isArray(input.guests) ? input.guests.slice(0, 40).map((guest: any, index: number) => ({
    id: String(guest?.id || `guest-${index + 1}`).slice(0, 80),
    name: String(guest?.name || '').trim().slice(0, 120),
    role: String(guest?.role || '').trim().slice(0, 120),
    bio: String(guest?.bio || '').trim().slice(0, 600),
    imageUrl: cleanExternalUrl(guest?.imageUrl),
    website: cleanExternalUrl(guest?.website),
    instagram: cleanExternalUrl(guest?.instagram),
    youtube: cleanExternalUrl(guest?.youtube),
    linkedin: cleanExternalUrl(guest?.linkedin),
    phone: String(guest?.phone || '').trim().slice(0, 30),
    vendorSlug: String(guest?.vendorSlug || '').trim().slice(0, 120),
    visible: guest?.visible !== false,
    sortOrder: Number.isFinite(Number(guest?.sortOrder)) ? Number(guest.sortOrder) : index,
  })).filter((guest: any) => guest.name) : [];
  return {
    enabled: Boolean(input.enabled),
    eyebrow: String(input.eyebrow || '').trim().slice(0, 100),
    heroImageUrl: cleanExternalUrl(input.heroImageUrl),
    venueName: String(input.venueName || '').trim().slice(0, 160),
    venueAddress: String(input.venueAddress || '').trim().slice(0, 300),
    mapUrl: cleanExternalUrl(input.mapUrl),
    registrationEnabled: input.registrationEnabled !== false,
    reminderEnabled: input.reminderEnabled !== false,
    reminderMode: input.reminderMode === 'all_day' ? 'all_day' : 'timed',
    countdownEnabled: input.countdownEnabled !== false,
    organizerVisible: input.organizerVisible !== false,
    contactVisible: Boolean(input.contactVisible),
    livestreamUrl: cleanExternalUrl(input.livestreamUrl),
    livestreamLabel: String(input.livestreamLabel || 'Watch live').trim().slice(0, 80),
    guests,
  };
}

/** Normalise a login phone to E.164 (+91XXXXXXXXXX) or null if blank. */
function normalizeLoginPhone(raw: unknown): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('+')) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return trimmed;
}

function cleanVendor(vendor: Vendor) {
  return {
    id: vendor.id,
    name: vendor.name,
    displayName: vendor.displayName,
    description: vendor.description,
    contact: vendor.contact ?? [],
    address: vendor.address,
    hasContactPage: vendor.hasContactPage,
    logoUrl: vendor.logoUrl ?? null,
    loginPhone: vendor.phone ?? null,
    requireLogin: vendor.requireLogin,
    createdAt: vendor.createdAt,
  };
}

function cleanEvent(event: Event) {
  const start = event.startTime ? new Date(event.startTime) : null;
  const end = event.endTime ? new Date(event.endTime) : null;
  const now = new Date();
  const derivedStatus = start && end && now >= start && now <= end ? 'active' : 'inactive';

  return {
    id: event.id,
    name: event.name,
    displayName: event.displayName,
    eventDescription: event.eventDescription,
    startTime: event.startTime,
    endTime: event.endTime,
    experienceConfig: cleanEventExperience(event.experienceConfig),
    status: event.getDataValue('status') ?? derivedStatus,
    vendorId: event.vendorId,
    vendor: event.vendor ? cleanVendor(event.vendor) : undefined,
    createdAt: event.createdAt,
  };
}

function cleanMenu(menu: Menu) {
  return {
    id: menu.id,
    name: menu.name,
    displayName: menu.displayName,
    description: menu.description,
    itemStoryHeading: menu.itemStoryHeading || 'The backstory',
    isActive: menu.isActive,
    vendorId: menu.vendorId,
    type: menu.getDataValue('type') ?? 'generic',
    sourceMenuId: menu.getDataValue('sourceMenuId') ?? null,
    vendor: menu.vendor ? cleanVendor(menu.vendor) : undefined,
    createdAt: menu.createdAt,
  };
}

function cleanItem(item: LineItem) {
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
    sortOrder: item.sortOrder ?? 0,
    price: item.price,
    tags: item.tags ?? [],
    allergens: item.allergens ?? [],
    isVeg: item.isVeg,
    spiceLevel: item.spiceLevel,
    menuId: item.menuId,
    parentId: item.parentId,
    createdAt: item.createdAt,
  };
}

function menuPath(eventName: string, menuName: string) {
  return `/event/${eventName}/menu/${menuName}`;
}

function itemPath(eventName: string, menuName: string, itemName: string) {
  return `${menuPath(eventName, menuName)}/item/${itemName}`;
}

function withUrls(mapping: QrLinkMapping, ctx: UrlContext) {
  const destination = mapping.url?.startsWith('/') ? mapping.url : mapping.url ? `/${mapping.url}` : undefined;
  const type = (mapping.type || 'static') as string;
  return {
    id: mapping.id,
    qrHash: mapping.qrHash,
    url: mapping.url,
    type,
    isActive: mapping.isActive,
    usageCount: mapping.usageCount,
    expiresAt: mapping.expiresAt,
    eventId: mapping.getDataValue('eventId') != null ? Number(mapping.getDataValue('eventId')) : null,
    vendorId: mapping.getDataValue('vendorId') != null ? Number(mapping.getDataValue('vendorId')) : null,
    createdAt: mapping.createdAt,
    updatedAt: mapping.updatedAt,
    shortQrUrl: mapping.qrHash ? `${ctx.origin}/${mapping.qrHash}` : undefined,
    finalPublicUrl: destination ? `${ctx.origin}${destination}` : undefined,
  };
}

// When menus are linked/unlinked, keep all event-type QRs for this event
// pointing to the current first linked menu. Pure URL update — redirect logic unchanged.
async function syncEventQrUrls(eventId: number, eventName: string) {
  const event = await Event.findByPk(eventId, { attributes: ['experienceConfig'] });
  const experienceEnabled = Boolean((event?.experienceConfig as any)?.enabled);
  const links = await EventMenuMapping.findAll({
    where: { eventId },
    attributes: await eventMenuMappingAttributes(),
    include: [{ model: Menu, attributes: ['name'] }],
    order: [['createdAt', 'ASC']],
  });
  const firstMenu = links[0]?.menu;
  const url = experienceEnabled
    ? `/event/${eventName}`
    : firstMenu
    ? `/event/${eventName}/menu/${firstMenu.name}`
    : `/event/${eventName}`;
  await QrLinkMapping.update(
    { url, updatedAt: new Date() },
    { where: { eventId, type: 'event' } as any }
  );
}

async function rewriteVendorQrDestination(vendorId: number, oldName: string, newName: string) {
  if (oldName === newName) return;
  const mappings = await QrLinkMapping.findAll({
    where: {
      [Op.or]: [
        { vendorId },
        { url: `/vendor/${oldName}` },
      ],
    } as any,
  });
  await Promise.all(mappings.map(async (mapping) => {
    if (mapping.url !== `/vendor/${oldName}`) return;
    await mapping.update({ url: `/vendor/${newName}`, vendorId, updatedAt: new Date() } as any);
  }));
}

async function rewriteEventQrDestinations(eventId: number, vendorId: number, oldName: string, newName: string) {
  const mappings = await QrLinkMapping.findAll({
    where: { [Op.or]: [{ eventId }, { vendorId }] } as any,
  });
  const oldPrefix = `/event/${oldName}`;
  await Promise.all(mappings.map(async (mapping) => {
    if (!mapping.url || (mapping.url !== oldPrefix && !mapping.url.startsWith(`${oldPrefix}/`))) return;
    await mapping.update({
      url: `/event/${newName}${mapping.url.slice(oldPrefix.length)}`,
      eventId,
      vendorId,
      updatedAt: new Date(),
    } as any);
  }));
}

async function rewriteMenuQrDestinations(oldVendorId: number, newVendorId: number, oldName: string, newName: string) {
  if (oldName === newName && oldVendorId === newVendorId) return;
  const mappings = await QrLinkMapping.findAll({
    where: { vendorId: { [Op.in]: [...new Set([oldVendorId, newVendorId])] } } as any,
  });
  const segment = `/menu/${oldName}`;
  await Promise.all(mappings.map(async (mapping) => {
    if (!mapping.url || !mapping.url.includes(segment)) return;
    const suffix = mapping.url.slice(mapping.url.indexOf(segment) + segment.length);
    if (suffix && !suffix.startsWith('/')) return;
    await mapping.update({
      url: mapping.url.replace(segment, `/menu/${newName}`),
      vendorId: newVendorId,
      updatedAt: new Date(),
    } as any);
  }));
}

async function rewriteItemQrDestinations(oldVendorId: number, newVendorId: number, oldMenuName: string, newMenuName: string, oldName: string, newName: string) {
  if (oldName === newName && oldMenuName === newMenuName && oldVendorId === newVendorId) return;
  const mappings = await QrLinkMapping.findAll({
    where: { vendorId: { [Op.in]: [...new Set([oldVendorId, newVendorId])] } } as any,
  });
  const menuSegment = `/menu/${oldMenuName}/`;
  const itemSuffix = `/item/${oldName}`;
  await Promise.all(mappings.map(async (mapping) => {
    if (!mapping.url || !mapping.url.includes(menuSegment) || !mapping.url.endsWith(itemSuffix)) return;
    const nextUrl = mapping.url
      .replace(menuSegment, `/menu/${newMenuName}/`)
      .replace(new RegExp(`/item/${oldName}$`), `/item/${newName}`);
    await mapping.update({
      url: nextUrl,
      vendorId: newVendorId,
      updatedAt: new Date(),
    } as any);
  }));
}

async function ensureVendorOwnsMenu(vendorId: number, menuId: number) {
  const menu = await Menu.findOne({ where: { id: menuId, vendorId } });
  if (!menu) throw badRequest('Menu does not belong to the selected vendor');
  return menu;
}

async function ensureVendorOwnsEvent(vendorId: number, eventId: number) {
  const event = await Event.findOne({ where: { id: eventId, vendorId }, attributes: await eventAttributes() });
  if (!event) throw badRequest('Event does not belong to the selected vendor');
  return event;
}

export const AdminService = {
  listVendors: async () => {
    const vendors = await Vendor.findAll({ order: [['createdAt', 'DESC']] });
    return vendors.map(cleanVendor);
  },

  createVendor: async (body: any) => {
    const name = requireSlug(body.name, 'Vendor slug');
    const displayName = requireText(body.displayName, 'Vendor display name');
    const existing = await Vendor.findOne({ where: { name } });
    if (existing) throw conflict('A vendor with this slug already exists. Use a unique manual slug such as adding city, venue, or a short random suffix.');

    const vendor = await Vendor.create({
      name,
      displayName,
      description: body.description?.trim() || null,
      contact: Array.isArray(body.contact) ? body.contact.filter(Boolean) : [],
      address: body.address?.trim() || null,
      hasContactPage: Boolean(body.hasContactPage),
      logoUrl: body.logoUrl?.trim() || null,
      phone: normalizeLoginPhone(body.loginPhone),
      requireLogin: Boolean(body.requireLogin),
    } as any);
    return cleanVendor(vendor);
  },

  updateVendor: async (id: number, body: any) => {
    const vendor = await Vendor.findByPk(id);
    if (!vendor) throw notFound('Vendor not found');
    const oldName = vendor.name;
    const name = body.name !== undefined ? requireSlug(body.name, 'Vendor slug') : vendor.name;
    if (name !== vendor.name) {
      const duplicate = await Vendor.findOne({ where: { name, id: { [Op.ne]: id } } });
      if (duplicate) throw conflict('A vendor with this slug already exists. Use a unique manual slug such as adding city, venue, or a short random suffix.');
    }
    await vendor.update({
      name,
      displayName: body.displayName !== undefined ? requireText(body.displayName, 'Vendor display name') : vendor.displayName,
      description: body.description?.trim() || null,
      contact: Array.isArray(body.contact) ? body.contact.filter(Boolean) : vendor.contact,
      address: body.address?.trim() || null,
      hasContactPage: body.hasContactPage !== undefined ? Boolean(body.hasContactPage) : vendor.hasContactPage,
      logoUrl: body.logoUrl !== undefined ? (body.logoUrl?.trim() || null) : vendor.logoUrl,
      phone: ('loginPhone' in body ? normalizeLoginPhone(body.loginPhone) : vendor.phone) as string | undefined,
      requireLogin: body.requireLogin !== undefined ? Boolean(body.requireLogin) : vendor.requireLogin,
    });
    await rewriteVendorQrDestination(id, oldName, name);
    return cleanVendor(vendor);
  },

  listEvents: async () => {
    const events = await Event.findAll({ attributes: await eventAttributes(), include: [Vendor], order: [['createdAt', 'DESC']] });
    return events.map(cleanEvent);
  },

  createEvent: async (body: any) => {
    const vendorId = Number(body.vendorId);
    if (!vendorId) throw badRequest('Vendor is required');
    const vendor = await Vendor.findByPk(vendorId);
    if (!vendor) throw badRequest('Selected vendor does not exist');
    const name = requireSlug(body.name, 'Event slug');
    const duplicate = await Event.findOne({ where: { vendorId, name }, attributes: ['id'] });
    if (duplicate) throw conflict('This vendor already has an event with this slug. Add the year, couple name, location, or a short suffix.');

    const startTime = optionalDate(body.startTime);
    const endTime = optionalDate(body.endTime);
    assertEventWindow(startTime, endTime);
    const createData: Record<string, unknown> = {
      vendorId,
      name,
      displayName: requireText(body.displayName, 'Event display name'),
      eventDescription: body.eventDescription?.trim() ?? '',
      startTime,
      endTime,
      experienceConfig: cleanEventExperience(body.experienceConfig),
    };
    if (await hasEventStatusColumn()) createData.status = isStatus(body.status) ? body.status : 'draft';
    const event = await Event.create(createData as any);
    event.vendor = vendor;
    return cleanEvent(event);
  },

  updateEvent: async (id: number, body: any) => {
    const event = await Event.findByPk(id, { attributes: await eventAttributes(), include: [Vendor] });
    if (!event) throw notFound('Event not found');
    const oldName = event.name;
    const vendorId = body.vendorId !== undefined ? Number(body.vendorId) : event.vendorId;
    if (!vendorId) throw badRequest('Vendor is required');
    const name = body.name !== undefined ? requireSlug(body.name, 'Event slug') : event.name;
    const duplicate = await Event.findOne({ where: { vendorId, name, id: { [Op.ne]: id } }, attributes: ['id'] });
    if (duplicate) throw conflict('This vendor already has an event with this slug. Add the year, couple name, location, or a short suffix.');

    const startTime = optionalDate(body.startTime) ?? null;
    const endTime = optionalDate(body.endTime) ?? null;
    assertEventWindow(startTime, endTime);
    const updateData: Record<string, unknown> = {
      vendorId,
      name,
      displayName: body.displayName !== undefined ? requireText(body.displayName, 'Event display name') : event.displayName,
      eventDescription: body.eventDescription?.trim() ?? '',
      startTime,
      endTime,
      experienceConfig: body.experienceConfig !== undefined
        ? cleanEventExperience(body.experienceConfig)
        : event.experienceConfig,
    };
    if (await hasEventStatusColumn()) updateData.status = isStatus(body.status) ? body.status : event.getDataValue('status');
    await event.update(updateData as any);
    await rewriteEventQrDestinations(id, vendorId, oldName, name);
    await syncEventQrUrls(id, name);
    return AdminService.getEvent(id);
  },

  updateEventExperience: async (id: number, body: any) => {
    const event = await Event.findByPk(id, { attributes: await eventAttributes(), include: [Vendor] });
    if (!event) throw notFound('Event not found');
    const experienceConfig = cleanEventExperience(body?.experienceConfig ?? body);
    await event.update({ experienceConfig } as any);
    await syncEventQrUrls(id, event.name);
    return AdminService.getEvent(id);
  },

  getEvent: async (id: number) => {
    const event = await Event.findByPk(id, { attributes: await eventAttributes(), include: [Vendor] });
    if (!event) throw notFound('Event not found');
    return cleanEvent(event);
  },

  listMenus: async () => {
    const menus = await Menu.findAll({ include: [Vendor], order: [['createdAt', 'DESC']] });
    return menus.map(cleanMenu);
  },

  createMenu: async (body: any) => {
    const vendorId = Number(body.vendorId);
    if (!vendorId) throw badRequest('Vendor is required');
    const vendor = await Vendor.findByPk(vendorId);
    if (!vendor) throw badRequest('Selected vendor does not exist');
    const name = requireSlug(body.name, 'Menu slug');
    const duplicate = await Menu.findOne({ where: { vendorId, name } });
    if (duplicate) throw conflict('This vendor already has a menu with this slug. Use a unique menu slug such as adding event type or version.');
    const menuType = body.type === 'personalized' ? 'personalized' : 'generic';
    const menu = await Menu.create({
      vendorId,
      name,
      displayName: requireText(body.displayName, 'Menu display name'),
      description: body.description?.trim() || null,
      itemStoryHeading: body.itemStoryHeading?.trim().slice(0, 80) || 'The backstory',
      isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
      type: menuType,
      sourceMenuId: body.sourceMenuId ? Number(body.sourceMenuId) : null,
    } as any);
    menu.vendor = vendor;
    return cleanMenu(menu);
  },

  updateMenu: async (id: number, body: any) => {
    const menu = await Menu.findByPk(id);
    if (!menu) throw notFound('Menu not found');
    const oldName = menu.name;
    const oldVendorId = menu.vendorId;
    const vendorId = body.vendorId !== undefined ? Number(body.vendorId) : menu.vendorId;
    if (!vendorId) throw badRequest('Vendor is required');
    const name = body.name !== undefined ? requireSlug(body.name, 'Menu slug') : menu.name;
    const duplicate = await Menu.findOne({ where: { vendorId, name, id: { [Op.ne]: id } } });
    if (duplicate) throw conflict('This vendor already has a menu with this slug. Use a unique menu slug such as adding event type or version.');
    await menu.update({
      vendorId,
      name,
      displayName: body.displayName !== undefined ? requireText(body.displayName, 'Menu display name') : menu.displayName,
      description: body.description?.trim() || null,
      itemStoryHeading: body.itemStoryHeading !== undefined
        ? (body.itemStoryHeading?.trim().slice(0, 80) || 'The backstory')
        : menu.itemStoryHeading,
      isActive: body.isActive !== undefined ? Boolean(body.isActive) : menu.isActive,
    });
    await rewriteMenuQrDestinations(oldVendorId, vendorId, oldName, name);
    const linkedEvents = await EventMenuMapping.findAll({
      where: { menuId: id },
      attributes: await eventMenuMappingAttributes(),
      include: [{ model: Event, attributes: await eventAttributes() }],
    });
    await Promise.all(linkedEvents.map((link) => syncEventQrUrls(link.eventId, link.event.name)));
    const updated = await Menu.findByPk(id, { include: [Vendor] });
    return cleanMenu(updated!);
  },

  linkMenuToEvent: async (eventId: number, menuId: number, displayName?: string) => {
    const event = await Event.findByPk(eventId, { attributes: await eventAttributes() });
    if (!event) throw notFound('Event not found');
    const menu = await ensureVendorOwnsMenu(event.vendorId, menuId);
    const defaults: Record<string, unknown> = { eventId, menuId };
    if (await hasEventMenuDisplayNameColumn()) defaults.displayName = displayName?.trim() || menu.displayName;
    const [mapping] = await EventMenuMapping.findOrCreate({
      where: { eventId, menuId },
      defaults: defaults as any,
    });
    if (displayName?.trim() && await hasEventMenuDisplayNameColumn()) {
      await mapping.update({ displayName: displayName.trim() } as any);
    }
    // Keep any assigned event QRs pointing to the current first menu
    await syncEventQrUrls(eventId, event.name);
    return AdminService.listEventMenus(eventId);
  },

  unlinkMenuFromEvent: async (eventId: number, menuId: number) => {
    await EventMenuMapping.destroy({ where: { eventId, menuId } });
    // Re-sync so QR URL updates to next menu (or falls back to event page if none left)
    const event = await Event.findByPk(eventId, { attributes: ['id', 'name'] });
    if (event) await syncEventQrUrls(eventId, event.name);
    return AdminService.listEventMenus(eventId);
  },

  listEventMenus: async (eventId: number) => {
    const mappings = await EventMenuMapping.findAll({
      where: { eventId },
      attributes: await eventMenuMappingAttributes(),
      include: [{ model: Menu, include: [Vendor] }],
    });
    return mappings.map((mapping) => ({
      ...cleanMenu(mapping.menu),
      eventMenuDisplayName: mappingDisplayName(mapping),
    }));
  },

  listItems: async (menuId?: number) => {
    const where = menuId ? { menuId } : {};
    const items = await LineItem.findAll({ where, include: [Menu], order: [['menuId', 'ASC'], ['sortOrder', 'ASC'], ['id', 'ASC']] });
    return items.map(cleanItem);
  },

  createItem: async (body: any) => {
    const menuId = Number(body.menuId);
    if (!menuId) throw badRequest('Menu is required');
    const menu = await Menu.findByPk(menuId);
    if (!menu) throw badRequest('Selected menu does not exist');
    const name = requireSlug(body.name, 'Item slug');
    const duplicate = await LineItem.findOne({ where: { menuId, name } });
    if (duplicate) throw conflict('This menu already has an item with this slug. Reuse the existing item as parent/category or choose a unique item slug.');
    if (body.parentId) {
      const parent = await LineItem.findOne({ where: { id: Number(body.parentId), menuId } });
      if (!parent) throw badRequest('Parent item must belong to the same menu');
    }
    const item = await LineItem.create({
      menuId,
      name,
      displayName: requireText(body.displayName, 'Item display name'),
      description: body.description?.trim() || null,
      ingredients: body.ingredients?.trim() || null,
      image: body.image?.trim() || null,
      type: body.type?.trim() || 'item',
      enumType: body.enumType?.trim() || null,
      isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
      sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
      price: body.price?.trim() || null,
      tags: Array.isArray(body.tags) ? body.tags.map(String).map((value: string) => value.trim()).filter(Boolean) : [],
      allergens: Array.isArray(body.allergens) ? body.allergens.map(String).map((value: string) => value.trim()).filter(Boolean) : [],
      isVeg: typeof body.isVeg === 'boolean' ? body.isVeg : null,
      spiceLevel: Number.isFinite(Number(body.spiceLevel)) ? Math.max(0, Math.min(3, Number(body.spiceLevel))) : null,
      parentId: body.parentId ? Number(body.parentId) : null,
    } as any);
    return cleanItem(item);
  },

  updateItem: async (id: number, body: any) => {
    const item = await LineItem.findByPk(id);
    if (!item) throw notFound('Item not found');
    const oldName = item.name;
    const oldMenu = await Menu.findByPk(item.menuId);
    if (!oldMenu) throw badRequest('Current menu does not exist');
    const menuId = body.menuId !== undefined ? Number(body.menuId) : item.menuId;
    const name = body.name !== undefined ? requireSlug(body.name, 'Item slug') : item.name;
    const duplicate = await LineItem.findOne({ where: { menuId, name, id: { [Op.ne]: id } } });
    if (duplicate) throw conflict('This menu already has an item with this slug. Reuse the existing item as parent/category or choose a unique item slug.');
    if (body.parentId) {
      const parent = await LineItem.findOne({ where: { id: Number(body.parentId), menuId } });
      if (!parent) throw badRequest('Parent item must belong to the same menu');
      let cursor: LineItem | null = parent;
      while (cursor) {
        if (cursor.id === id) throw badRequest('An item cannot be moved inside itself or one of its descendants');
        cursor = cursor.parentId ? await LineItem.findByPk(cursor.parentId) : null;
      }
    }
    await item.update({
      menuId,
      name,
      displayName: body.displayName !== undefined ? requireText(body.displayName, 'Item display name') : item.displayName,
      description: body.description?.trim() || null,
      ingredients: body.ingredients?.trim() || null,
      image: body.image?.trim() || null,
      type: body.type?.trim() || item.type,
      enumType: body.enumType?.trim() || null,
      isActive: body.isActive !== undefined ? Boolean(body.isActive) : item.isActive,
      sortOrder: body.sortOrder !== undefined && Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : item.sortOrder,
      price: body.price !== undefined ? (body.price?.trim() || null) : item.price,
      tags: Array.isArray(body.tags) ? body.tags.map(String).map((value: string) => value.trim()).filter(Boolean) : item.tags,
      allergens: Array.isArray(body.allergens) ? body.allergens.map(String).map((value: string) => value.trim()).filter(Boolean) : item.allergens,
      isVeg: body.isVeg !== undefined ? (typeof body.isVeg === 'boolean' ? body.isVeg : null) : item.isVeg,
      spiceLevel: body.spiceLevel !== undefined && Number.isFinite(Number(body.spiceLevel)) ? Math.max(0, Math.min(3, Number(body.spiceLevel))) : item.spiceLevel,
      parentId: body.parentId ? Number(body.parentId) : null,
    } as any);
    const newMenu = menuId === oldMenu.id ? oldMenu : await Menu.findByPk(menuId);
    if (!newMenu) throw badRequest('Selected menu does not exist');
    await rewriteItemQrDestinations(oldMenu.vendorId, newMenu.vendorId, oldMenu.name, newMenu.name, oldName, name);
    return cleanItem(item);
  },

  listQrMappings: async (ctx: UrlContext, vendorId?: number) => {
    const where = vendorId ? { vendorId } : {};
    const mappings = await QrLinkMapping.findAll({ where: where as any, order: [['createdAt', 'DESC']] });
    if (!mappings.length) return [];

    // Enrich with real scan counts from analytics_event (usageCount column is never incremented)
    const hashes = mappings.map(m => m.qrHash).filter(Boolean) as string[];
    let scanCounts: Record<string, number> = {};
    if (hashes.length) {
      try {
        const rows = await sequelize.query<{ qr_hash: string; cnt: string }>(
          `SELECT qr_hash, COUNT(*) AS cnt FROM analytics_event
           WHERE event_type = 'qr_scan' AND qr_hash IN (:hashes)
           GROUP BY qr_hash`,
          { replacements: { hashes }, type: QueryTypes.SELECT }
        );
        rows.forEach(r => { scanCounts[r.qr_hash] = Number(r.cnt); });
      } catch {
        // analytics table may not exist yet — fall back to usageCount
      }
    }

    return mappings.map(m => ({
      ...withUrls(m, ctx),
      usageCount: scanCounts[m.qrHash ?? ''] ?? m.usageCount ?? 0,
    }));
  },

  upsertQrMapping: async (body: any, ctx: UrlContext) => {
    const qrHash = requireSlug(body.qrHash, 'QR hash');
    const type = body.type === 'event' ? 'event' : 'static';
    let url: string | null = null;
    if (type === 'event') {
      // Auto-build the event-level URL from eventId so the pure redirect model still works
      const eventId = Number(body.eventId);
      if (!eventId) throw badRequest('Event is required for event-type QRs');
      const event = await Event.findByPk(eventId, { attributes: ['name'] });
      if (!event) throw badRequest('Event not found');
      url = `/event/${event.name}`;
    } else {
      url = requireText(body.url, 'Destination URL');
      if (!url.startsWith('/')) {
        throw badRequest('Destination URL must be an internal path starting with /');
      }
    }
    const existing = await QrLinkMapping.findOne({ where: { qrHash } });
    const data: Record<string, unknown> = {
      qrHash,
      url,
      type,
      isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
      expiresAt: optionalDate(body.expiresAt) ?? null,
      updatedAt: new Date(),
    };
    if (body.eventId !== undefined) data.eventId = Number(body.eventId) || null;
    if (body.vendorId !== undefined) data.vendorId = Number(body.vendorId) || null;
    const mapping = existing
      ? await existing.update(data as any)
      : await QrLinkMapping.create({ ...data, usageCount: 0 } as any);
    return withUrls(mapping, ctx);
  },

  updateQrMapping: async (id: number, body: any, ctx: UrlContext) => {
    const mapping = await QrLinkMapping.findByPk(id);
    if (!mapping) throw notFound('QR mapping not found');
    const type = body.type !== undefined ? (body.type === 'event' ? 'event' : 'static') : (mapping.type || 'static');
    let url = mapping.url;
    if (body.url !== undefined) {
      if (type === 'event') {
        // Keep the url derived from eventId; if eventId changes, recompute
        if (body.eventId !== undefined) {
          const event = await Event.findByPk(Number(body.eventId), { attributes: ['name'] });
          url = event ? `/event/${event.name}` : mapping.url;
        }
      } else {
        url = requireText(body.url, 'Destination URL');
        if (!url.startsWith('/')) throw badRequest('Destination URL must be an internal path starting with /');
      }
    }
    const data: Record<string, unknown> = { updatedAt: new Date(), type };
    if (body.url !== undefined || body.type !== undefined || body.eventId !== undefined) data.url = url;
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);
    if (body.expiresAt !== undefined) data.expiresAt = optionalDate(body.expiresAt) ?? null;
    if (body.eventId !== undefined) data.eventId = Number(body.eventId) || null;
    if (body.vendorId !== undefined) data.vendorId = Number(body.vendorId) || null;
    await mapping.update(data as any);
    return withUrls(mapping, ctx);
  },

  getOrCreateEventQr: async (eventId: number, ctx: UrlContext) => {
    const event = await Event.findByPk(eventId, { attributes: await eventAttributes() });
    if (!event) throw notFound('Event not found');

    // Return existing event-dynamic QR if one exists
    const existing = await QrLinkMapping.findOne({ where: { eventId, type: 'event' } as any });
    if (existing) return withUrls(existing, ctx);

    // Build a unique hash: prefer event slug, add suffix if taken
    let qrHash = event.name;
    if (await QrLinkMapping.findOne({ where: { qrHash } })) {
      qrHash = `${event.name}-qr`;
    }
    if (await QrLinkMapping.findOne({ where: { qrHash } })) {
      qrHash = `${event.name}-${Date.now().toString(36)}`;
    }

    const mapping = await QrLinkMapping.create({
      qrHash,
      url: `/event/${event.name}`,  // placeholder; syncEventQrUrls immediately overwrites if menus exist
      type: 'event',
      eventId,
      vendorId: event.vendorId,
      isActive: true,
      usageCount: 0,
    } as any);
    // Immediately sync so the URL reflects current linked menus (if any)
    await syncEventQrUrls(eventId, event.name);
    const updated = await QrLinkMapping.findByPk(mapping.id);
    return withUrls(updated!, ctx);
  },

  setEventStatus: async (id: number, status: string) => {
    if (!isStatus(status)) throw badRequest('Status must be draft, active, or inactive');
    const event = await Event.findByPk(id, { attributes: await eventAttributes(), include: [Vendor] });
    if (!event) throw notFound('Event not found');
    if (status === 'active') {
      if (!event.startTime || !event.endTime) throw badRequest('Add event start and end times before publishing');
      const standaloneReady = Boolean((event.experienceConfig as any)?.enabled);
      if (!standaloneReady) {
        const linkedMenuCount = await EventMenuMapping.count({ where: { eventId: id } });
        if (!linkedMenuCount) throw badRequest('Enable and save the public event page, or link at least one menu, before publishing');
      }
    }
    await Event.sequelize!.transaction(async (t) => {
      await event.update({ status } as any, { transaction: t });
      if (status === 'active' || status === 'inactive') {
        await QrLinkMapping.update(
          { isActive: status === 'active', updatedAt: new Date() } as any,
          { where: { eventId: id } as any, transaction: t }
        );
      }
    });
    return AdminService.getEvent(id);
  },

  getItemPool: async (vendorId: number) => {
    const menus = await Menu.findAll({
      where: { vendorId },
      attributes: ['id', 'name', 'displayName'],
      order: [['createdAt', 'ASC']],
    });
    if (!menus.length) return [];
    const menuIds = menus.map((m) => m.id);
    const items = await LineItem.findAll({
      where: { menuId: menuIds } as any,
      include: [{ model: Menu, attributes: ['id', 'name', 'displayName'] }],
      order: [['menuId', 'ASC'], ['name', 'ASC']],
    });
    return items.map((item) => ({
      ...cleanItem(item),
      menuName: (item.menu as any)?.name,
      menuDisplayName: (item.menu as any)?.displayName,
    }));
  },

  copyMenu: async (sourceMenuId: number, body: any) => {
    const source = await Menu.findByPk(sourceMenuId, { include: [{ model: LineItem }] });
    if (!source) throw notFound('Source menu not found');
    const vendorId = Number(body.vendorId ?? source.vendorId);
    if (!vendorId) throw badRequest('Vendor is required');
    const name = requireSlug(body.name, 'Menu slug');
    const duplicate = await Menu.findOne({ where: { vendorId, name } });
    if (duplicate) throw conflict('This vendor already has a menu with this slug.');

    const newMenu = await Menu.create({
      vendorId,
      name,
      displayName: requireText(body.displayName, 'Menu display name'),
      description: body.description?.trim() || source.description || null,
      itemStoryHeading: body.itemStoryHeading?.trim().slice(0, 80) || source.itemStoryHeading || 'The backstory',
      isActive: true,
      type: 'personalized',
      sourceMenuId: source.id,
    } as any);

    // Copy items in two passes: parents first, then children (preserving nesting)
    const sourceItems = source.lineItems ?? [];
    const idMap = new Map<number, number>();
    const roots = sourceItems.filter((i) => !i.parentId);
    const children = sourceItems.filter((i) => i.parentId);

    for (const item of [...roots, ...children]) {
      const created = await LineItem.create({
        menuId: newMenu.id,
        name: item.name,
        displayName: item.displayName,
        description: item.description ?? null,
        ingredients: item.ingredients ?? null,
        image: item.image ?? null,
        type: item.type ?? 'item',
        enumType: item.enumType ?? null,
        isActive: item.isActive,
        sortOrder: item.sortOrder ?? 0,
        price: item.price ?? null,
        tags: item.tags ?? [],
        allergens: item.allergens ?? [],
        isVeg: item.isVeg ?? null,
        spiceLevel: item.spiceLevel ?? null,
        parentId: item.parentId ? (idMap.get(item.parentId) ?? null) : null,
      } as any);
      idMap.set(item.id, created.id as number);
    }

    const result = await Menu.findByPk(newMenu.id, { include: [Vendor] });
    return cleanMenu(result!);
  },

  getPreviews: async (ctx: UrlContext) => {
    const [events, menus, items] = await Promise.all([
      Event.findAll({ attributes: await eventAttributes(), include: [Vendor] }),
      Menu.findAll({ include: [Vendor] }),
      LineItem.findAll(),
    ]);
    const mappings = await EventMenuMapping.findAll({
      attributes: await eventMenuMappingAttributes(),
      include: [{ model: Event, attributes: await eventAttributes() }, Menu],
    });
    return {
      events: events.map(cleanEvent),
      menus: mappings.map((mapping) => ({
        eventId: mapping.eventId,
        menuId: mapping.menuId,
        eventName: mapping.event.name,
        menuName: mapping.menu.name,
        displayName: mappingDisplayName(mapping),
        publicPath: menuPath(mapping.event.name, mapping.menu.name),
        publicUrl: `${ctx.origin}${menuPath(mapping.event.name, mapping.menu.name)}`,
      })),
      items: mappings.flatMap((mapping) =>
        items
          .filter((item) => item.menuId === mapping.menuId)
          .map((item) => ({
            itemId: item.id,
            menuId: mapping.menuId,
            eventId: mapping.eventId,
            eventName: mapping.event.name,
            menuName: mapping.menu.name,
            menuDisplayName: mappingDisplayName(mapping),
            itemName: item.name,
            publicPath: itemPath(mapping.event.name, mapping.menu.name, item.name),
            publicUrl: `${ctx.origin}${itemPath(mapping.event.name, mapping.menu.name, item.name)}`,
          }))
      ),
      allMenus: menus.map(cleanMenu),
    };
  },

  buildMenuPath: async (eventId: number, menuId: number, ctx: UrlContext) => {
    const event = await Event.findByPk(eventId, { attributes: await eventAttributes() });
    if (!event) throw notFound('Event not found');
    const menu = await ensureVendorOwnsMenu(event.vendorId, menuId);
    const path = menuPath(event.name, menu.name);
    return { path, publicUrl: `${ctx.origin}${path}` };
  },

  buildItemPath: async (eventId: number, itemId: number, ctx: UrlContext) => {
    const event = await Event.findByPk(eventId, { attributes: await eventAttributes() });
    if (!event) throw notFound('Event not found');
    const item = await LineItem.findByPk(itemId);
    if (!item) throw notFound('Item not found');
    const menu = await ensureVendorOwnsMenu(event.vendorId, item.menuId);
    const path = itemPath(event.name, menu.name, item.name);
    return { path, publicUrl: `${ctx.origin}${path}` };
  },

  listQrTemplates: (actor?: StudioActor) =>
    QrTemplate.findAll({
      where: actor?.role === 'vendor'
        ? { [Op.or]: [{ vendorId: Number(actor.vendorId) }, { vendorId: null }] }
        : undefined,
      order: [['updatedAt', 'DESC']],
    }),

  getQrTemplate: async (id: number, actor?: StudioActor) => {
    const template = await QrTemplate.findByPk(id);
    if (!template) throw notFound('Design not found');
    if (actor?.role === 'vendor' && template.vendorId !== null && Number(template.vendorId) !== Number(actor.vendorId)) {
      throw forbidden('This design belongs to another workspace');
    }
    return template;
  },

  createQrTemplate: (body: any, actor?: StudioActor) => {
    const libraryTemplateId = String(body.libraryTemplateId || '');
    const qrStyle = String(body.qrStyle || 'obsidian-ring');
    const theme = String(body.theme || 'light');
    if (!isKnownTemplateId(libraryTemplateId)) throw badRequest('Unknown QR Studio library template');
    if (!QR_STYLES.has(qrStyle)) throw badRequest('Unknown QR signature');
    if (!QR_THEMES.has(theme)) throw badRequest('Unknown template theme');
    assertApprovedDestination(body.settings, body.document);
    return QrTemplate.create({
      name: body.name || 'Untitled Template',
      widthMm: Number(body.widthMm) || 85,
      heightMm: Number(body.heightMm) || 54,
      elements: body.elements ?? [],
      vendorId: actorVendorId(actor, body.vendorId),
      libraryTemplateId,
      manifestVersion: String(body.manifestVersion || '3.1.0').slice(0, 20),
      qrStyle,
      theme,
      settings: body.settings && typeof body.settings === 'object' ? body.settings : {},
      schemaVersion: String(body.schemaVersion || '1.0.0').slice(0, 20),
      document: body.document && typeof body.document === 'object' ? body.document : null,
      revision: 1,
      previewThumbnail: typeof body.previewThumbnail === 'string' ? body.previewThumbnail : null,
    } as any);
  },

  updateQrTemplate: async (id: number, body: any, actor?: StudioActor) => {
    const tpl = await QrTemplate.findByPk(id);
    if (!tpl) throw notFound('Template not found');
    assertTemplateWritable(tpl, actor);
    if (body.revision != null && Number(body.revision) !== tpl.revision) {
      throw conflict('This design was updated in another tab. Reload before saving again.');
    }
    if (body.libraryTemplateId != null && !isKnownTemplateId(String(body.libraryTemplateId))) throw badRequest('Unknown QR Studio library template');
    if (body.qrStyle != null && !QR_STYLES.has(String(body.qrStyle))) throw badRequest('Unknown QR signature');
    if (body.theme != null && !QR_THEMES.has(String(body.theme))) throw badRequest('Unknown template theme');
    assertApprovedDestination(body.settings, body.document);
    await tpl.update({
      name: body.name ?? tpl.name,
      widthMm: body.widthMm != null ? Number(body.widthMm) : tpl.widthMm,
      heightMm: body.heightMm != null ? Number(body.heightMm) : tpl.heightMm,
      elements: body.elements ?? tpl.elements,
      vendorId: actor?.role === 'vendor' ? tpl.vendorId : (body.vendorId !== undefined ? actorVendorId(actor, body.vendorId) : tpl.vendorId),
      libraryTemplateId: body.libraryTemplateId ?? tpl.libraryTemplateId,
      manifestVersion: body.manifestVersion ?? tpl.manifestVersion,
      qrStyle: body.qrStyle ?? tpl.qrStyle,
      theme: body.theme ?? tpl.theme,
      settings: body.settings ?? tpl.settings,
      schemaVersion: body.schemaVersion ?? tpl.schemaVersion,
      document: body.document ?? tpl.document,
      revision: tpl.revision + 1,
      previewThumbnail: body.previewThumbnail ?? tpl.previewThumbnail,
    });
    return tpl;
  },

  duplicateQrTemplate: async (id: number, body: any, actor?: StudioActor) => {
    const source = await QrTemplate.findByPk(id);
    if (!source) throw notFound('Design not found');
    if (actor?.role === 'vendor' && source.vendorId !== null && Number(source.vendorId) !== Number(actor.vendorId)) {
      throw forbidden('This design belongs to another workspace');
    }
    return QrTemplate.create({
      name: String(body?.name || `${source.name} copy`).slice(0, 120),
      widthMm: source.widthMm,
      heightMm: source.heightMm,
      elements: source.elements,
      vendorId: actorVendorId(actor, source.vendorId),
      libraryTemplateId: source.libraryTemplateId,
      manifestVersion: source.manifestVersion,
      qrStyle: source.qrStyle,
      theme: source.theme,
      settings: source.settings,
      schemaVersion: source.schemaVersion,
      document: source.document,
      revision: 1,
      previewThumbnail: source.previewThumbnail,
    } as any);
  },

  validateQrTemplate: async (id: number, actor?: StudioActor) => {
    const tpl = await AdminService.getQrTemplate(id, actor);
    const settings = (tpl.settings || {}) as Record<string, unknown>;
    const errors: string[] = [];
    try { assertApprovedDestination(settings, tpl.document); } catch (error: any) { errors.push(error.message); }
    if (!isKnownTemplateId(String(tpl.libraryTemplateId || ''))) errors.push('Unknown source template');
    if (!QR_STYLES.has(String(tpl.qrStyle || ''))) errors.push('Unknown QR signature');
    if (!QR_THEMES.has(String(tpl.theme || ''))) errors.push('Unknown template theme');
    return { valid: errors.length === 0, errors, revision: tpl.revision };
  },

  deleteQrTemplate: async (id: number, actor?: StudioActor) => {
    const tpl = await QrTemplate.findByPk(id);
    if (!tpl) throw notFound('Template not found');
    assertTemplateWritable(tpl, actor);
    await tpl.destroy();
    return { ok: true };
  },

  // ── DELETE operations ──────────────────────────────────────────────────────

  deleteVendor: async (id: number) => {
    const vendor = await Vendor.findByPk(id);
    if (!vendor) throw notFound('Vendor not found');
    const eventCount = await Event.count({ where: { vendorId: id } });
    if (eventCount > 0) throw badRequest(`Cannot delete: vendor has ${eventCount} event(s). Delete all events first.`);
    const menuCount = await Menu.count({ where: { vendorId: id } });
    if (menuCount > 0) throw badRequest(`Cannot delete: vendor has ${menuCount} menu(s). Delete all menus first.`);
    await vendor.destroy();
    return { ok: true };
  },

  deleteEvent: async (id: number) => {
    const event = await Event.findByPk(id, { attributes: await eventAttributes() });
    if (!event) throw notFound('Event not found');
    const status = event.getDataValue('status');
    if (status === 'active') throw badRequest('Cannot delete an active event. Deactivate it first.');
    // Cascade: remove event–menu links and associated QR mappings, then delete event
    await EventMenuMapping.destroy({ where: { eventId: id } });
    await QrLinkMapping.destroy({ where: { eventId: id } } as any);
    await event.destroy();
    return { ok: true };
  },

  deleteMenu: async (id: number) => {
    const menu = await Menu.findByPk(id);
    if (!menu) throw notFound('Menu not found');
    const linkCount = await EventMenuMapping.count({ where: { menuId: id } });
    if (linkCount > 0) throw badRequest(`Cannot delete: menu is linked to ${linkCount} event(s). Unlink it first.`);
    // Cascade: delete all items in this menu, then delete the menu
    await LineItem.destroy({ where: { menuId: id } });
    await menu.destroy();
    return { ok: true };
  },

  deleteItem: async (id: number) => {
    const item = await LineItem.findByPk(id);
    if (!item) throw notFound('Item not found');
    // Orphan any children before deleting (null out their parentId)
    await LineItem.update({ parentId: null } as any, { where: { parentId: id } as any });
    await item.destroy();
    return { ok: true };
  },

  deleteQrMapping: async (id: number) => {
    const mapping = await QrLinkMapping.findByPk(id);
    if (!mapping) throw notFound('QR mapping not found');
    await mapping.destroy();
    return { ok: true };
  },
};
