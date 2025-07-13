import { QrLinkMapping } from '../models/qrLinkMapping.model';

export const QrLinkMappingRepo = {
  findAll: async () => QrLinkMapping.findAll(),

  getById: async (id: number) => QrLinkMapping.findByPk(id),

  getByHash: async (qrHash: string) => QrLinkMapping.findOne({ where: { qrHash } }),
};
