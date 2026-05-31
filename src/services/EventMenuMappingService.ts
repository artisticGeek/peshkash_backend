import { EventMenuMappingRepo } from '../repositories/eventMenuMapping.repository';
import { EventMenuMapping } from '../models/eventMenuMapping.model';

export const EventMenuMappingService = {
  getMenuForEvent: async (eventName: string, menuName: string): Promise<{ mapping: EventMenuMapping | null, isEventActive: boolean }> => {
    const mapping = await EventMenuMappingRepo.getMenuByEventAndMenuName(eventName, menuName);

    if (!mapping) return { mapping: null, isEventActive: false };

    const event = mapping.event;
    const now = new Date();
    // An event is active when:
    //   • No start/end times are set (perpetual — typical for menus used year-round)
    //   • OR the current time is within the configured window
    // Previously, "no times" incorrectly returned false, causing the fallback
    // (empty lineItems + "event expired" UI) for all freshly-created events.
    const hasWindow = !!(event?.startTime && event?.endTime);
    const isEventActive = !hasWindow || (event!.startTime! <= now && event!.endTime! >= now);

    return { mapping, isEventActive };
  }
};
