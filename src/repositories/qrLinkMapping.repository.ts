import { Op } from 'sequelize';
import { QrLinkMapping } from '../models/qrLinkMapping.model';

export const QrLinkMappingRepo = {
  findAll: async () => QrLinkMapping.findAll(),

  getById: async (id: number) => QrLinkMapping.findByPk(id),

  getByHash: async (qrHash: string) => QrLinkMapping.findOne({ where: { qrHash } }),

  findWithNullVendorId: async () =>
    QrLinkMapping.findAll({ where: { vendorId: { [Op.is]: null as any } } }),

  setVendorId: async (id: number, vendorId: number) =>
    QrLinkMapping.update({ vendorId }, { where: { id } }),
};
