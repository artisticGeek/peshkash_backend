import { EventRegistrationService } from '../services/EventRegistrationService';

/** Sends scheduled post-event feedback requests (Peshkash 5.0). Checks once a minute. */
let timer: NodeJS.Timeout | null = null;

export function startFeedbackWorker(intervalMs = 60_000) {
  if (timer) return;
  const tick = () => EventRegistrationService.dispatchDueFeedback()
    .catch((error) => console.error('[FeedbackWorker] tick failed:', error?.message ?? error));
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
  tick();
}
