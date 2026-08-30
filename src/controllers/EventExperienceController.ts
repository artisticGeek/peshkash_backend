import { Request, Response } from 'express';
import { QueryTypes } from 'sequelize';
import { sequelize } from '../config/sequelize';
import { Event } from '../models/event.model';
import { Vendor } from '../models/vendor.model';
import { AnalyticsRecorder } from '../services/AnalyticsRecorder';

function publicVendor(vendor: Vendor | undefined, contactVisible: boolean) {
  if (!vendor) return null;
  return {
    id: Number(vendor.id),
    name: vendor.name,
    displayName: vendor.displayName,
    description: vendor.description,
    logoUrl: vendor.logoUrl ?? null,
    ...(contactVisible ? { contact: vendor.contact ?? [], address: vendor.address } : {}),
  };
}

async function findEvent(eventName: string) {
  return Event.findOne({
    where: { name: eventName },
    attributes: ['id', 'name', 'displayName', 'eventDescription', 'startTime', 'endTime', 'status', 'experienceConfig', 'vendorId'],
    include: [Vendor],
  });
}

export const EventExperienceController = {
  /** Public read model for a menu-independent event landing page. */
  getPublicEvent: async (req: Request, res: Response) => {
    try {
      const event = await findEvent(req.params.eventName);
      const config = (event?.experienceConfig ?? {}) as Record<string, any>;
      if (!event || !config.enabled) return res.status(404).json({ error: 'Event page not found' });
      const canPreview = req.user?.role === 'admin' || (req.user?.role === 'vendor' && Number(req.user.vendorId) === Number(event.vendorId));
      if (event.status !== 'active' && !canPreview) return res.status(404).json({ error: 'Event page not found' });

      let registered = false;
      if (req.user?.phone) {
        const rows = await sequelize.query<{ exists: boolean }>(
          `SELECT EXISTS(
             SELECT 1 FROM event_registration WHERE event_id = :eventId AND phone = :phone
           ) AS exists`,
          { replacements: { eventId: event.id, phone: req.user.phone }, type: QueryTypes.SELECT },
        );
        registered = Boolean(rows[0]?.exists);
      }

      res.set('Cache-Control', 'no-store');
      return res.json({
        id: Number(event.id),
        name: event.name,
        displayName: event.displayName,
        description: event.eventDescription,
        startTime: event.startTime,
        endTime: event.endTime,
        status: event.status,
        experience: config,
        organizer: config.organizerVisible === false ? null : publicVendor(event.vendor, Boolean(config.contactVisible)),
        registered,
      });
    } catch (error) {
      console.error('[EventExperience] public event failed:', error);
      return res.status(500).json({ error: 'Event page unavailable' });
    }
  },

  /** Idempotent registration bound to the verified OTP phone in the JWT. */
  register: async (req: Request, res: Response) => {
    try {
      if (!req.user?.phone) return res.status(401).json({ error: 'Phone verification required' });
      const event = await findEvent(req.params.eventName);
      const config = (event?.experienceConfig ?? {}) as Record<string, any>;
      if (!event || !config.enabled) return res.status(404).json({ error: 'Event page not found' });
      if (event.status !== 'active') return res.status(409).json({ error: 'This event is not open for registration' });
      if (config.registrationEnabled === false) return res.status(403).json({ error: 'Registration is not enabled for this event' });
      if (event.endTime && Date.now() > new Date(event.endTime).getTime()) {
        return res.status(409).json({ error: 'This event has ended' });
      }

      await sequelize.query(
        `INSERT INTO event_registration (event_id, phone)
         VALUES (:eventId, :phone)
         ON CONFLICT (event_id, phone)
         DO UPDATE SET updated_at = NOW()`,
        { replacements: { eventId: event.id, phone: req.user.phone }, type: QueryTypes.INSERT },
      );
      AnalyticsRecorder.recordAction({
        actionType: 'event_registration',
        eventId: Number(event.id),
        vendorId: Number(event.vendorId),
        phone: req.user.phone,
        pageUrl: req.body?.pageUrl,
      }, req);
      return res.json({ ok: true, registered: true, phone: req.user.phone });
    } catch (error) {
      console.error('[EventExperience] registration failed:', error);
      return res.status(500).json({ error: 'Could not complete registration' });
    }
  },
};
