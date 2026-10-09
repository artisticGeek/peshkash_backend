import { Request, Response } from 'express';
import { EventMenuMappingService } from '../services/EventMenuMappingService';
import { MapperUtil } from '../utils/MapperUtil';
import { QrLinkMappingService } from '../services/QrLinkMappingService';
import { AnalyticsRecorder } from '../services/AnalyticsRecorder';
import { QrLinkMappingRepo } from '../repositories/qrLinkMapping.repository';
import { VendorRepo } from '../repositories/vendor.repository';
import { DeviceLinkService } from '../services/DeviceLinkService';
import { Event } from '../models/event.model';
import { Menu } from '../models/menu.model';
import { LineItem } from '../models/lineItem.model';
import { EventMenuMapping } from '../models/eventMenuMapping.model';

function publicContactRows(contact: unknown): string[] {
  if (!Array.isArray(contact)) return [];
  return contact.filter((row): row is string => {
    if (typeof row !== 'string') return false;
    if (!row.toLowerCase().startsWith('phone:')) return true;
    const value = row.slice(row.indexOf(':') + 1).trim();
    const digits = value.replace(/\D/g, '');
    return /^[+\d\s().-]+$/.test(value) && digits.length >= 7 && digits.length <= 15;
  });
}

export const QrMappingController = {
  getMenuByEventAndMenuName: async (req: Request, res: Response) => {
    const eventName = req.params.eventName;
    const menuName = req.params.menuName;

    try {
      const { mapping, isEventActive } = await EventMenuMappingService.getMenuForEvent(eventName, menuName);

      if (!mapping) {
        return res.status(404).json({ message: 'No menu found for the given event' });
      }

      const responseDto = isEventActive
        ? MapperUtil.mapActiveEventResponse(mapping)
        : MapperUtil.mapFallbackEventResponse(mapping);

      return res.json(responseDto);

    } catch (error) {
      console.error('Error fetching event menu mapping:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  },

  getDishDetails: async (req: Request, res: Response) => {
    const { eventName, menuName, itemName } = req.params;

    try {
      const { mapping, isEventActive } = await EventMenuMappingService.getMenuForEvent(eventName, menuName);

      if (!mapping) {
        return res.status(404).json({ message: 'No menu found for the given event' });
      }

      // History retains the item's identity, but a saved link must not bypass
      // the event's public availability window.
      if (!isEventActive) {
        const ended = Boolean(mapping.event?.endTime && mapping.event.endTime < new Date());
        return res.status(ended ? 410 : 403).json({
          code: ended ? 'EVENT_EXPIRED' : 'EVENT_UNAVAILABLE',
          message: ended
            ? 'This event has ended, so its item details are no longer available.'
            : 'This event is not available yet.',
          eventName: mapping.event?.displayName,
          endedAt: mapping.event?.endTime ?? null,
        });
      }

      const targetItem = mapping.menu?.lineItems?.find(item => item.name === itemName);
      if (!targetItem || !targetItem.isActive) {
        return res.status(404).json({ code: 'ITEM_UNAVAILABLE', message: 'This item is no longer available.' });
      }

      const responseDto = MapperUtil.mapActiveEventResponse(mapping, itemName);

      return res.json(responseDto);

    } catch (error) {
      console.error('Error fetching specific dish:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  },

  redirectByQrHash: async (req: Request, res: Response) => {
    try {
      const { qrHash } = req.params;   // <- must match :qrHash in router
      const deviceId = typeof req.query.deviceId === 'string' ? req.query.deviceId : undefined;

      if (!qrHash) {
        return res.status(400).json({ error: 'QR hash is required' });
      }

      if (deviceId) DeviceLinkService.touch(deviceId);

      const redirectionUrl = await QrLinkMappingService.getHashRedirectionUrl(qrHash);

      if (!redirectionUrl) {
        // Record a not-found scan for observability
        AnalyticsRecorder.recordScan({
          qrHash,
          qrStatus: 'not_found',
          resolved: false,
          deviceId,
          req,
        });
        return res.status(404).json({ error: 'QR code not found' });
      }

      console.log(redirectionUrl.redirectionUrl);

      // Non-blocking scan recording — MUST NOT delay or break the response
      QrLinkMappingRepo.getByHash(qrHash).then(async mapping => {
        let vendorId: number | undefined = mapping?.vendorId ?? undefined;
        let eventId:  number | undefined = mapping?.eventId  ?? undefined;
        const resolvedUrl = mapping?.url ?? redirectionUrl.redirectionUrl;

        // Infer vendorId from the redirect URL when not stored on the mapping
        if (!vendorId) {
          const inferred = await QrLinkMappingService.inferVendorIdFromUrl(resolvedUrl);
          if (inferred) {
            vendorId = inferred;
            if (mapping) await QrLinkMappingRepo.setVendorId(mapping.id, inferred);
          }
        }

        // Infer eventId from URL like /event/{slug} when not stored on the mapping
        if (!eventId) {
          const inferred = await QrLinkMappingService.inferEventIdFromUrl(resolvedUrl);
          if (inferred) {
            eventId = inferred;
            if (mapping) await QrLinkMappingRepo.setEventId(mapping.id, inferred);
          }
        }

        AnalyticsRecorder.recordScan({
          qrHash,
          qrType: mapping?.type,
          qrStatus: mapping?.isActive ? 'active' : 'inactive',
          resolved: true,
          resolvedUrl: redirectionUrl.redirectionUrl,
          vendorId,
          eventId,
          deviceId,
          req,
        });
      }).catch(() => {/* silent — analytics never blocks */});

      // Prevent browser/CDN from caching QR lookup responses — each scan must
      // reach the server so it can be recorded as a separate analytics event.
      res.set('Cache-Control', 'no-store');
      return res.send(redirectionUrl);
    } catch (error) {
      console.error('Error handling QR redirection:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  },

  getVendorCard: async (req: Request, res: Response) => {
    const { vendorName } = req.params;

    try {
      const VendorRepo = (await import('../repositories/vendor.repository')).VendorRepo;
      const vendor = await VendorRepo.getByName(vendorName);

      if (!vendor) {
        return res.status(404).json({ error: 'Vendor not found' });
      }

      if (!vendor.hasContactPage) {
        return res.status(403).json({ error: 'Vendor contact page not enabled' });
      }

      const [events, menus] = await Promise.all([
        Event.findAll({ where: { vendorId: vendor.id }, order: [['startTime', 'ASC']] }),
        Menu.findAll({ where: { vendorId: vendor.id, isActive: true }, order: [['createdAt', 'DESC']] }),
      ]);
      const publicMenus = await Promise.all(menus.map(async menu => {
        const [itemCount, mapping] = await Promise.all([
          LineItem.count({ where: { menuId: menu.id, isActive: true } }),
          EventMenuMapping.findOne({ where: { menuId: menu.id }, include: [{ model: Event, attributes: ['name'] }], order: [['createdAt', 'DESC']] }),
        ]);
        return {
          id: Number(menu.id),
          name: menu.name,
          displayName: menu.displayName,
          description: menu.description,
          type: menu.type,
          itemCount,
          publicPath: mapping?.event?.name ? `/event/${mapping.event.name}/menu/${menu.name}` : null,
        };
      }));
      const storedMode = String(vendor.contactPageMode || 'classic').toLowerCase();
      const contactPageMode = storedMode === 'page'
        ? 'editorial'
        : ['classic', 'editorial', 'lookbook', 'programme', 'shopfront'].includes(storedMode) ? storedMode : 'classic';

      // Return the public vendor profile and the content available to its configured page.
      return res.json({
        id: vendor.id,
        name: vendor.name,
        displayName: vendor.displayName,
        description: vendor.description,
        contact: publicContactRows(vendor.contact),
        address: vendor.address,
        logoUrl: vendor.logoUrl ?? null,
        requireLogin: vendor.requireLogin ?? false,
        contactPageMode,
        contactPageConfig: vendor.contactPageConfig ?? {},
        events: events.map(event => ({
          id: Number(event.id),
          name: event.name,
          displayName: event.displayName,
          description: event.eventDescription,
          startTime: event.startTime,
          endTime: event.endTime,
          status: event.status,
          experience: event.experienceConfig ?? {},
        })),
        menus: publicMenus,
      });

    } catch (error) {
      console.error('Error fetching vendor card:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }
};
