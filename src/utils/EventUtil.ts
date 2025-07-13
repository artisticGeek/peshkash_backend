import { Event } from '../models/event.model';

export const isEventActive = (event: Event): boolean => {
  if (!event.startTime || !event.endTime) {
    return false; // Treat incomplete data as inactive
  }

  const now = new Date();
  return now >= new Date(event.startTime) && now <= new Date(event.endTime);
};
