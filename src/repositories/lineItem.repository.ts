import { LineItem } from '../models/lineItem.model';
import { Menu } from '../models/menu.model';

export const LineItemRepo = {
  findAll: async () => LineItem.findAll({ include: [Menu] }),

  getById: async (id: number) => LineItem.findByPk(id, { include: [Menu] }),

  getByName: async (name: string) => LineItem.findOne({ where: { name }, include: [Menu] }),
};
