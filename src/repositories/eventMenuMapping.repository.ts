import { Op } from 'sequelize';
import { EventMenuMapping } from '../models/eventMenuMapping.model';
import { Event } from '../models/event.model';
import { Menu } from '../models/menu.model';
import { LineItem } from '../models/lineItem.model';
import { Vendor } from '../models/vendor.model';

export const EventMenuMappingRepo = {
  findAll: async () => {
    return await EventMenuMapping.findAll({
      include: [Event, Menu],
    });
  },

  getById: async (id: number) => {
    return await EventMenuMapping.findByPk(id, {
      include: [Event, Menu],
    });
  },

getMenuByEventAndMenuName: async (eventName: string, menuName: string) => {
  console.log('Received for repo lookup:', { eventName, menuName });

  return await EventMenuMapping.findOne({
    include: [
      {
        model: Event,
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
