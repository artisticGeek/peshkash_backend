import { EventMenuMapping } from '../models/eventMenuMapping.model';
import { Event } from '../models/event.model';
import { Menu } from '../models/menu.model';
import { LineItem } from '../models/lineItem.model';
import { Vendor } from '../models/vendor.model';

const eventPublicAttributes = [
  'id',
  'name',
  'eventDescription',
  'displayName',
  'startTime',
  'endTime',
  'createdAt',
  'vendorId',
];

const eventMenuMappingPublicAttributes = ['id', 'eventId', 'menuId', 'createdAt'];

export const EventMenuMappingRepo = {
  findAll: async () => {
    return await EventMenuMapping.findAll({
      attributes: eventMenuMappingPublicAttributes,
      include: [{ model: Event, attributes: eventPublicAttributes }, Menu],
    });
  },

  getById: async (id: number) => {
    return await EventMenuMapping.findByPk(id, {
      attributes: eventMenuMappingPublicAttributes,
      include: [{ model: Event, attributes: eventPublicAttributes }, Menu],
    });
  },

getMenuByEventAndMenuName: async (eventName: string, menuName: string) => {
  console.log('Received for repo lookup:', { eventName, menuName });

  return await EventMenuMapping.findOne({
    attributes: eventMenuMappingPublicAttributes,
    include: [
      {
        model: Event,
        attributes: eventPublicAttributes,
        where: { name: eventName },
        include: [{ model: Vendor }],
      },
      {
        model: Menu,
        where: { name: menuName },
        include: [{ model: LineItem, required: false }],
      },
    ],
  });
},
};
