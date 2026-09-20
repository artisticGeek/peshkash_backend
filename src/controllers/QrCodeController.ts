import { Request, Response } from 'express';
import { EventMenuMappingService } from '../services/EventMenuMappingService';
import { MapperUtil } from '../utils/MapperUtil';
import { QrLinkMappingService } from '../services/QrLinkMappingService';
import { AnalyticsRecorder } from '../services/AnalyticsRecorder';
import { QrLinkMappingRepo } from '../repositories/qrLinkMapping.repository';
import { VendorRepo } from '../repositories/vendor.repository';
import { DeviceLinkService } from '../services/DeviceLinkService';

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

      // Return vendor contact information
      return res.json({
        id: vendor.id,
        name: vendor.name,
        displayName: vendor.displayName,
        description: vendor.description,
        contact: vendor.contact,
        address: vendor.address,
        logoUrl: vendor.logoUrl ?? null,
        requireLogin: vendor.requireLogin ?? false,
      });

    } catch (error) {
      console.error('Error fetching vendor card:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }
};
