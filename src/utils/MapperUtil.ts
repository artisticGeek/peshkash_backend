import { EventMenuMapping } from '../models/eventMenuMapping.model';
import { LineItem } from '../models/lineItem.model';
import { LineItemDTO } from '../models/dto/menuDetailResponse.dto';
import { EventSummaryDTO } from '../models/dto/event.dto';
import { VendorSummaryDTO } from '../models/dto/vendor.dto';

// Function overloads
function mapLineItemsRecursively(items: LineItem[], parentId?: number | null): LineItemDTO[];
function mapLineItemsRecursively(items: LineItem[], parentId: number | null, itemName?: string): LineItemDTO[];

// Unified implementation
function mapLineItemsRecursively(
  items: LineItem[],
  parentId: number | null = null,
  itemName?: string
): LineItemDTO[] {
  return items
    .filter(item => item.parentId === parentId)
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
        description: item.description,
        isActive: item.isActive,
        createdAt: item.createdAt,
        itemType: item.type,
        subCategoryLineItems: subItems,
      };
    })
    .filter(Boolean) as LineItemDTO[];
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
    const lineItems = mapping.menu?.lineItems || [];
    const nestedLineItems = MapperUtil.mapLineItemsRecursively(lineItems, null, itemName);

    return {
      responseType: itemName ? 'ITEM' : 'MENU',
      id: mapping.id,
      createdAt: mapping.createdAt,
      event: MapperUtil.mapEvent(mapping.event),
      vendor: MapperUtil.mapVendor(mapping.event?.vendor),
      menu: {
        id: mapping.menu?.id,
        name: mapping.menu?.name,
        displayName: mapping.menu?.displayName,
        description: mapping.menu?.description,
        isActive: mapping.menu?.isActive,
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
        isActive: mapping.menu?.isActive,
        createdAt: mapping.menu?.createdAt,
        vendorId: mapping.menu?.vendorId,
        lineItems: [],
      },
    };
  },
};
