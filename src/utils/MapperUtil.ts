import { EventMenuMapping } from '../models/eventMenuMapping.model';
import { LineItem } from '../models/lineItem.model';
import { LineItemDTO } from '../models/dto/menuDetailResponse.dto';
import { EventSummaryDTO } from '../models/dto/event.dto';
import { VendorSummaryDTO } from '../models/dto/vendor.dto';

export const MapperUtil = {
  mapLineItemsRecursively: (
    items: LineItem[],
    parentId: number | null = null
  ): LineItemDTO[] => {
    return items
      .filter((item) => item.parentId === parentId)
      .map((item) => {
        if (!item.type) {
          throw new Error(`LineItem with id ${item.id} is missing a type`);
        }

        return {
          id: item.id,
          name: item.name,
          description: item.description,
          isActive: item.isActive,
          createdAt: item.createdAt,
          itemType: item.type,
          subCategoryLineItems: MapperUtil.mapLineItemsRecursively(items, item.id),
        };
      });
  },

  mapVendor: (vendor: any): VendorSummaryDTO => ({
    id: vendor.id,
    name: vendor.name,
    displayName: vendor.displayName,
    contact: vendor.contact,
    address: vendor.address,
    description: vendor.description
  }),

  mapEvent: (event: any): EventSummaryDTO => ({
    id: event.id,
    name: event.name,
    displayName: event.displayName,
    description: event.eventDescription,
    startTime: event.startTime,
    endTime: event.endTime
  }),

  mapActiveEventResponse: (mapping: EventMenuMapping) => {
    const lineItems = mapping.menu?.lineItems || [];
    const nestedLineItems = MapperUtil.mapLineItemsRecursively(lineItems);

    return {
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
      id: mapping.id,
      createdAt: mapping.createdAt,
      event: MapperUtil.mapEvent(mapping.event),
      vendor: MapperUtil.mapVendor(mapping.event?.vendor),
    };
  },
};
