import { Request, Response } from 'express';
import { EventMenuMappingService } from '../services/EventMenuMappingService';
import { MapperUtil } from '../utils/MapperUtil';
import { QrLinkMappingService } from '../services/QrLinkMappingService';
import { AnalyticsRecorder } from '../services/AnalyticsRecorder';
import { QrLinkMappingRepo } from '../repositories/qrLinkMapping.repository';

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

      const responseDto = isEventActive
        ? MapperUtil.mapActiveEventResponse(mapping, itemName)
        : MapperUtil.mapFallbackEventResponse(mapping);

      return res.json(responseDto);

    } catch (error) {
      console.error('Error fetching specific dish:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  },

  redirectByQrHash: async (req: Request, res: Response) => {
    try {
      const { qrHash } = req.params;   // <- must match :qrHash in router

      if (!qrHash) {
        return res.status(400).json({ error: 'QR hash is required' });
      }

      const redirectionUrl = await QrLinkMappingService.getHashRedirectionUrl(qrHash);

      if (!redirectionUrl) {
        // Record a not-found scan for observability
        AnalyticsRecorder.recordScan({
          qrHash,
          qrStatus: 'not_found',
          resolved: false,
          req,
        });
        return res.status(404).json({ error: 'QR code not found' });
      }

      console.log(redirectionUrl.redirectionUrl);

      // Non-blocking scan recording — MUST NOT delay or break the response
      QrLinkMappingRepo.getByHash(qrHash).then(mapping => {
        AnalyticsRecorder.recordScan({
          qrHash,
          qrType: mapping?.type,
          qrStatus: mapping?.isActive ? 'active' : 'inactive',
          resolved: true,
          resolvedUrl: redirectionUrl.redirectionUrl,
          vendorId: mapping?.vendorId,
          eventId: mapping?.eventId,
          req,
        });
      }).catch(() => {/* silent — analytics never blocks */});

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
      });

    } catch (error) {
      console.error('Error fetching vendor card:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }
};
