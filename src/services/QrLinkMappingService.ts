import { QrLinkMapping } from '../models/qrLinkMapping.model';
import { QrLinkMappingRepo } from '../repositories/qrLinkMapping.repository';

export const QrLinkMappingService = {

    getHashRedirectionUrl: async (qrHash: string): Promise<{ redirectionUrl: string } | null> => {
        const qrLinkMapping: QrLinkMapping | null = await QrLinkMappingRepo.getByHash(qrHash);

        if (!qrLinkMapping || !qrLinkMapping.url || !qrLinkMapping.isActive) {
            return null; // no mapping found
        }
        
        return { redirectionUrl: qrLinkMapping.url };
    }
};
