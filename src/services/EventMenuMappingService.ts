import { EventMenuMappingRepo } from '../repositories/eventMenuMapping.repository';
import { EventMenuMapping } from '../models/eventMenuMapping.model';

export const EventMenuMappingService = {
  getMenuForEvent: async (eventName: string, menuName: string): Promise<{ mapping: EventMenuMapping | null, isEventActive: boolean }> => {
    const mapping = await EventMenuMappingRepo.getMenuByEventAndMenuName(eventName, menuName);

    if (!mapping) return { mapping: null, isEventActive: false };

    const event = mapping.event;
    const now = new Date();
    const isEventActive = !!(event?.startTime && event?.endTime && event.startTime <= now && event.endTime >= now);
    console.log('Mapping found in repo:', !!mapping, 'Event:', mapping?.event?.name, 'Menu:', mapping?.menu?.name);

    return { mapping, isEventActive };
  }
};
