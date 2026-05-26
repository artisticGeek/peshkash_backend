import { Op, QueryTypes } from 'sequelize';
import { Event } from '../models/event.model';
import { EventMenuMapping } from '../models/eventMenuMapping.model';
import { LineItem } from '../models/lineItem.model';
import { Menu } from '../models/menu.model';
import { QrLinkMapping } from '../models/qrLinkMapping.model';
import { QrTemplate } from '../models/qrTemplate.model';
import { Vendor } from '../models/vendor.model';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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
  const attrs = ['id', 'name', 'eventDescription', 'displayName', 'startTime', 'endTime', 'createdAt', 'vendorId'];
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
  const attrs = ['id', 'eventId', 'menuId', 'createdAt'];
  if (await hasEventMenuDisplayNameColumn()) attrs.push('displayName');
  return attrs;
}

function mappingDisplayName(mapping: EventMenuMapping) {
  return mapping.getDataValue('displayName') || mapping.menu.displayName;
}

function badRequest(message: string) {
  return Object.assign(new Error(message), { status: 400 });
}

function notFound(message: string) {
  return Object.assign(new Error(message), { status: 404 });
}

function conflict(message: string) {
  return Object.assign(new Error(message), { status: 409 });
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
  return {
    id: mapping.id,
    qrHash: mapping.qrHash,
    url: mapping.url,
    isActive: mapping.isActive,
    usageCount: mapping.usageCount,
    expiresAt: mapping.expiresAt,
    eventId: mapping.getDataValue('eventId') ?? null,
    vendorId: mapping.getDataValue('vendorId') ?? null,
    createdAt: mapping.createdAt,
    updatedAt: mapping.updatedAt,
    shortQrUrl: mapping.qrHash ? `${ctx.origin}/${mapping.qrHash}` : undefined,
    finalPublicUrl: destination ? `${ctx.origin}${destination}` : undefined,
  };
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
    } as any);
    return cleanVendor(vendor);
  },

  updateVendor: async (id: number, body: any) => {
    const vendor = await Vendor.findByPk(id);
    if (!vendor) throw notFound('Vendor not found');
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
    });
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

    const createData: Record<string, unknown> = {
      vendorId,
      name,
      displayName: requireText(body.displayName, 'Event display name'),
      eventDescription: body.eventDescription?.trim() || null,
      startTime: optionalDate(body.startTime),
      endTime: optionalDate(body.endTime),
    };
    if (await hasEventStatusColumn()) createData.status = isStatus(body.status) ? body.status : 'draft';
    const event = await Event.create(createData as any);
    event.vendor = vendor;
    return cleanEvent(event);
  },

  updateEvent: async (id: number, body: any) => {
    const event = await Event.findByPk(id, { attributes: await eventAttributes(), include: [Vendor] });
    if (!event) throw notFound('Event not found');
    const vendorId = body.vendorId !== undefined ? Number(body.vendorId) : event.vendorId;
    if (!vendorId) throw badRequest('Vendor is required');
    const name = body.name !== undefined ? requireSlug(body.name, 'Event slug') : event.name;
    const duplicate = await Event.findOne({ where: { vendorId, name, id: { [Op.ne]: id } }, attributes: ['id'] });
    if (duplicate) throw conflict('This vendor already has an event with this slug. Add the year, couple name, location, or a short suffix.');

    const updateData: Record<string, unknown> = {
      vendorId,
      name,
      displayName: body.displayName !== undefined ? requireText(body.displayName, 'Event display name') : event.displayName,
      eventDescription: body.eventDescription?.trim() || null,
      startTime: optionalDate(body.startTime) ?? null,
      endTime: optionalDate(body.endTime) ?? null,
    };
    if (await hasEventStatusColumn()) updateData.status = isStatus(body.status) ? body.status : event.getDataValue('status');
    await event.update(updateData as any);
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
      isActive: body.isActive !== undefined ? Boolean(body.isActive) : menu.isActive,
    });
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
    return AdminService.listEventMenus(eventId);
  },

  unlinkMenuFromEvent: async (eventId: number, menuId: number) => {
    await EventMenuMapping.destroy({ where: { eventId, menuId } });
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
    const items = await LineItem.findAll({ where, include: [Menu], order: [['createdAt', 'DESC']] });
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
      parentId: body.parentId ? Number(body.parentId) : null,
    } as any);
    return cleanItem(item);
  },

  updateItem: async (id: number, body: any) => {
    const item = await LineItem.findByPk(id);
    if (!item) throw notFound('Item not found');
    const menuId = body.menuId !== undefined ? Number(body.menuId) : item.menuId;
    const name = body.name !== undefined ? requireSlug(body.name, 'Item slug') : item.name;
    const duplicate = await LineItem.findOne({ where: { menuId, name, id: { [Op.ne]: id } } });
    if (duplicate) throw conflict('This menu already has an item with this slug. Reuse the existing item as parent/category or choose a unique item slug.');
    if (body.parentId) {
      const parent = await LineItem.findOne({ where: { id: Number(body.parentId), menuId } });
      if (!parent) throw badRequest('Parent item must belong to the same menu');
      if (Number(body.parentId) === id) throw badRequest('An item cannot be its own parent');
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
      parentId: body.parentId ? Number(body.parentId) : null,
    } as any);
    return cleanItem(item);
  },

  listQrMappings: async (ctx: UrlContext) => {
    const mappings = await QrLinkMapping.findAll({ order: [['createdAt', 'DESC']] });
    return mappings.map((mapping) => withUrls(mapping, ctx));
  },

  upsertQrMapping: async (body: any, ctx: UrlContext) => {
    const qrHash = requireSlug(body.qrHash, 'QR hash');
    const url = requireText(body.url, 'Destination URL');
    if (!url.startsWith('/event/') && !url.startsWith('/vendor/')) {
      throw badRequest('Destination URL must be an internal public path such as /event/... or /vendor/...');
    }
    const existing = await QrLinkMapping.findOne({ where: { qrHash } });
    const data: Record<string, unknown> = {
      qrHash,
      url,
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
    const url = body.url !== undefined ? requireText(body.url, 'Destination URL') : mapping.url;
    if (url && !url.startsWith('/event/') && !url.startsWith('/vendor/')) {
      throw badRequest('Destination URL must be an internal public path such as /event/... or /vendor/...');
    }
    const data: Record<string, unknown> = { updatedAt: new Date() };
    if (body.url !== undefined) data.url = url;
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);
    if (body.expiresAt !== undefined) data.expiresAt = optionalDate(body.expiresAt) ?? null;
    if (body.eventId !== undefined) data.eventId = Number(body.eventId) || null;
    if (body.vendorId !== undefined) data.vendorId = Number(body.vendorId) || null;
    await mapping.update(data as any);
    return withUrls(mapping, ctx);
  },

  setEventStatus: async (id: number, status: string) => {
    if (!isStatus(status)) throw badRequest('Status must be draft, active, or inactive');
    const event = await Event.findByPk(id, { attributes: await eventAttributes(), include: [Vendor] });
    if (!event) throw notFound('Event not found');
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

  listQrTemplates: () =>
    QrTemplate.findAll({ order: [['updatedAt', 'DESC']] }),

  createQrTemplate: (body: any) =>
    QrTemplate.create({
      name: body.name || 'Untitled Template',
      widthMm: Number(body.widthMm) || 85,
      heightMm: Number(body.heightMm) || 54,
      elements: body.elements ?? [],
    } as any),

  updateQrTemplate: async (id: number, body: any) => {
    const tpl = await QrTemplate.findByPk(id);
    if (!tpl) throw notFound('Template not found');
    await tpl.update({
      name: body.name ?? tpl.name,
      widthMm: body.widthMm != null ? Number(body.widthMm) : tpl.widthMm,
      heightMm: body.heightMm != null ? Number(body.heightMm) : tpl.heightMm,
      elements: body.elements ?? tpl.elements,
    });
    return tpl;
  },

  deleteQrTemplate: async (id: number) => {
    const tpl = await QrTemplate.findByPk(id);
    if (!tpl) throw notFound('Template not found');
    await tpl.destroy();
    return { ok: true };
  },
};
