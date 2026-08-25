import { QrLinkMappingRepo } from '../repositories/qrLinkMapping.repository';
import { VendorRepo } from '../repositories/vendor.repository';
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

    /**
     * Infer a vendorId from a URL path like /vendor/{slug}.
     * Returns the vendor's numeric id, or undefined if no match.
     */
    inferVendorIdFromUrl: async (url: string | undefined): Promise<number | undefined> => {
        if (!url) return undefined;
        const m = url.match(/\/vendor\/([^/?#]+)/);
        if (!m) return undefined;
        const vendor = await VendorRepo.getByName(m[1]);
        return vendor?.id ?? undefined;
    },

    /**
     * One-time startup job: set vendor_id on qr_link_mapping rows where it is
     * NULL but the stored url contains a /vendor/{slug} path.
     */
    backfillVendorIds: async (): Promise<void> => {
        try {
            const mappings = await QrLinkMappingRepo.findWithNullVendorId();
            let updated = 0;
            for (const m of mappings) {
                const vendorId = await QrLinkMappingService.inferVendorIdFromUrl(m.url);
                if (vendorId) {
                    await QrLinkMappingRepo.setVendorId(m.id, vendorId);
                    updated++;
                }
            }
            if (updated > 0) console.log(`✅ [QrLinkMapping] Backfilled vendor_id on ${updated} QR mapping(s)`);
        } catch (err) {
            console.error('[QrLinkMapping] backfillVendorIds failed:', err);
        }
    },

    getHashRedirectionUrl: async (qrHash: string): Promise<{ redirectionUrl: string } | null> => {
        const qrLinkMapping = await QrLinkMappingRepo.getByHash(qrHash);

        if (!qrLinkMapping || !qrLinkMapping.url || !qrLinkMapping.isActive) {
            return null;
        }

        return { redirectionUrl: await normalizeDestination(qrLinkMapping.url) };
    }
};
