import { QrLinkMapping } from '../models/qrLinkMapping.model';
import { QrLinkMappingRepo } from '../repositories/qrLinkMapping.repository';
import { Event } from '../models/event.model';
import { Menu } from '../models/menu.model';
import { LineItem } from '../models/lineItem.model';

async function normalizeDestination(url: string) {
    const trimmed = url.trim();
    const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;

    const itemIdMatch = withSlash.match(/^\/event\/(\d+)\/menu\/(\d+)\/item\/(\d+)$/);
    if (itemIdMatch) {
        const [, eventId, menuId, itemId] = itemIdMatch;
        const [event, menu, item] = await Promise.all([
            Event.findByPk(Number(eventId), { attributes: ['name'] }),
            Menu.findByPk(Number(menuId), { attributes: ['name'] }),
            LineItem.findByPk(Number(itemId), { attributes: ['name'] }),
        ]);
        if (event && menu && item) {
            return `/event/${event.name}/menu/${menu.name}/item/${item.name}`;
        }
    }

    const menuIdMatch = withSlash.match(/^\/event\/(\d+)\/menu\/(\d+)$/);
    if (menuIdMatch) {
        const [, eventId, menuId] = menuIdMatch;
        const [event, menu] = await Promise.all([
            Event.findByPk(Number(eventId), { attributes: ['name'] }),
            Menu.findByPk(Number(menuId), { attributes: ['name'] }),
        ]);
        if (event && menu) {
            return `/event/${event.name}/menu/${menu.name}`;
        }
    }

    return withSlash;
}

export const QrLinkMappingService = {

    getHashRedirectionUrl: async (qrHash: string): Promise<{ redirectionUrl: string } | null> => {
        const qrLinkMapping: QrLinkMapping | null = await QrLinkMappingRepo.getByHash(qrHash);

        if (!qrLinkMapping || !qrLinkMapping.url || !qrLinkMapping.isActive) {
            return null; // no mapping found
        }
        
        return { redirectionUrl: await normalizeDestination(qrLinkMapping.url) };
    }
};
