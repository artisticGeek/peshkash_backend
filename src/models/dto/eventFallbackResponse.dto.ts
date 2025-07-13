import { EventSummaryDTO } from './event.dto';
import { VendorSummaryDTO } from './vendor.dto';

export interface EventMenuFallbackDTO {
  event: EventSummaryDTO;
  vendor: VendorSummaryDTO;
}
