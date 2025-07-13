import { Menu } from '../models/menu.model';
import { Vendor } from '../models/vendor.model';

export const MenuRepo = {
  findAll: async () => Menu.findAll({ include: [Vendor] }),

  getById: async (id: number) => Menu.findByPk(id, { include: [Vendor] }),

  getByName: async (name: string) => Menu.findOne({ where: { name }, include: [Vendor] }),
};
