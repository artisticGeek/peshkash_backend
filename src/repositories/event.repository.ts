import { Event } from '../models/event.model';
import { Vendor } from '../models/vendor.model';

export const EventRepo = {
  findAll: async () => Event.findAll({ include: [Vendor] }),

  getById: async (id: number) => Event.findByPk(id, { include: [Vendor] }),

  getByName: async (name: string) => Event.findOne({ where: { name }, include: [Vendor] }),
};
