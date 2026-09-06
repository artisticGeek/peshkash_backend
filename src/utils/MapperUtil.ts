import { EventMenuMapping } from '../models/eventMenuMapping.model';
import { LineItem } from '../models/lineItem.model';
import { LineItemDTO } from '../models/dto/menuDetailResponse.dto';
import { EventSummaryDTO } from '../models/dto/event.dto';
import { VendorSummaryDTO } from '../models/dto/vendor.dto';
import { Menu } from '../models/menu.model';

function mapLineItemsRecursively(items: LineItem[], parentId?: number | null): LineItemDTO[];
function mapLineItemsRecursively(items: LineItem[], parentId: number | null, itemName?: string): LineItemDTO[];

function mapLineItemsRecursively(
  items: LineItem[],
  parentId: number | null = null,
  itemName?: string
): LineItemDTO[] {
  return items
    .filter(item => item.parentId === parentId)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id)
    .map(item => {
      if (!item.type) {
        throw new Error(`LineItem with id ${item.id} is missing a type`);
      }

      const subItems = mapLineItemsRecursively(items, item.id, itemName);

      const isMatch = itemName
        ? item.name === itemName || subItems.length > 0
        : true;

      if (!isMatch) return null;

      return {
        id: item.id,
        name: item.name,
        displayName: item.displayName ?? item.name,
        description: item.description,
        isActive: item.isActive,
        createdAt: item.createdAt,
        itemType: item.type,
        enumType: item.enumType,
        image: item.image ?? null,
        sortOrder: item.sortOrder ?? 0,
        price: item.price,
        tags: item.tags ?? [],
        allergens: item.allergens ?? [],
        isVeg: item.isVeg,
        spiceLevel: item.spiceLevel,
        subCategoryLineItems: subItems,
      };
    })
    .filter(Boolean) as LineItemDTO[];
}

// 🔽 NEW FUNCTION TO MAP SPECIFIC ITEM DETAILS
function mapSpecificItemResponse(mapping: EventMenuMapping, itemName: string) {
  const allItems = mapping.menu?.lineItems || [];

  // Find the item
  const targetItem = allItems.find(item => item.name === itemName);
  if (!targetItem) {
    throw new Error(`Item with name '${itemName}' not found`);
  }

  // Find parent hierarchy (flat array)
  const parentItems: LineItem[] = [];
  let currentParentId = targetItem.parentId;

  while (currentParentId) {
    const parent = allItems.find(item => item.id === currentParentId);
    if (parent) {
      parentItems.unshift(parent); // build in ascending order
      currentParentId = parent.parentId;
    } else {
      break;
    }
  }

  return {
    responseType: 'ITEM',
    id: targetItem.name, // same as name
    numericId: targetItem.id,
    name: targetItem.name,
    description: targetItem.description,
    isActive: targetItem.isActive,
    createdAt: targetItem.createdAt,
    itemType: targetItem.type,
    event: mapping.event,
    displayName: targetItem.displayName,
    menu: getMenuSummary(mapping.menu),
    ingredients: targetItem.ingredients,
    image: targetItem.image,
    price: targetItem.price,
    tags: targetItem.tags ?? [],
    allergens: targetItem.allergens ?? [],
    isVeg: targetItem.isVeg,
    spiceLevel: targetItem.spiceLevel,
    parentItems: parentItems.map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      isActive: p.isActive,
      createdAt: p.createdAt,
      itemType: p.type,
      displayName: p.displayName
    })),
  };
}

export const MapperUtil = {
  mapLineItemsRecursively,

  mapVendor: (vendor: any): VendorSummaryDTO => ({
    id: vendor.id,
    name: vendor.name,
    displayName: vendor.displayName,
    contact: vendor.contact,
    address: vendor.address,
    description: vendor.description,
    logoUrl: vendor.logoUrl ?? null,
    hasContactPage: vendor.hasContactPage ?? false,
    requireLogin: vendor.requireLogin ?? false,
  }),

  mapEvent: (event: any): EventSummaryDTO => ({
    id: event.id,
    name: event.name,
    displayName: event.displayName,
    description: event.eventDescription,
    startTime: event.startTime,
    endTime: event.endTime,
  }),

  mapActiveEventResponse: (mapping: EventMenuMapping, itemName?: string) => {
    if (itemName) {
      return mapSpecificItemResponse(mapping, itemName);
    }

    const lineItems = mapping.menu?.lineItems || [];
    const nestedLineItems = MapperUtil.mapLineItemsRecursively(lineItems);

    return {
      responseType: 'MENU',
      id: mapping.id,
      createdAt: mapping.createdAt,
      event: MapperUtil.mapEvent(mapping.event),
      vendor: MapperUtil.mapVendor(mapping.event?.vendor),
      menu: {
        id: mapping.menu?.id,
        name: mapping.menu?.name,
        displayName: mapping.menu?.displayName,
        description: mapping.menu?.description,
        itemStoryHeading: mapping.menu?.itemStoryHeading || 'The backstory',
        elaborateDescriptions: mapping.menu?.elaborateDescriptions ?? false,
        isActive: mapping.menu?.isActive,
        type: mapping.menu?.getDataValue?.('type') ?? 'generic',
        createdAt: mapping.menu?.createdAt,
        vendorId: mapping.menu?.vendorId,
        lineItems: nestedLineItems,
      },
    };
  },

  mapFallbackEventResponse: (mapping: EventMenuMapping) => {
    return {
      responseType: 'MENU',
      id: mapping.id,
      createdAt: mapping.createdAt,
      event: MapperUtil.mapEvent(mapping.event),
      vendor: MapperUtil.mapVendor(mapping.event?.vendor),
      menu: {
        id: mapping.menu?.id,
        name: mapping.menu?.name,
        displayName: mapping.menu?.displayName,
        description: mapping.menu?.description,
        itemStoryHeading: mapping.menu?.itemStoryHeading || 'The backstory',
        elaborateDescriptions: mapping.menu?.elaborateDescriptions ?? false,
        isActive: mapping.menu?.isActive,
        type: mapping.menu?.getDataValue?.('type') ?? 'generic',
        createdAt: mapping.menu?.createdAt,
        vendorId: mapping.menu?.vendorId,
        lineItems: [],
      },
    };
  },
};
function getMenuSummary(menu: Menu) {
  return {
    id: menu.id,
    name: menu.name,
    displayName: menu.displayName,
    description: menu.description,
    itemStoryHeading: menu.itemStoryHeading || 'The backstory',
    elaborateDescriptions: menu.elaborateDescriptions ?? false,
    isActive: menu.isActive,
    type: menu.getDataValue?.('type') ?? 'generic',
  }
}

