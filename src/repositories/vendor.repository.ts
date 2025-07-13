import { Vendor } from '../models/vendor.model';

export const VendorRepo = {
  findAll: async () => Vendor.findAll(),

  getById: async (id: number) => Vendor.findByPk(id),

  getByName: async (name: string) => Vendor.findOne({ where: { name } }),
};
