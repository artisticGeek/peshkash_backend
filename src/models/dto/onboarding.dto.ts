import { PricingModelType } from '../vendorPricingConfig.model';

// ─── Menu ─────────────────────────────────────────────────────────────────────

export interface MenuSummaryDTO {
  id: number;
  name: string;
  displayName: string;
  description?: string;
  isActive: boolean;
  createdAt: Date;
}

export interface CreateMenuDTO {
  name: string;
  displayName: string;
  description?: string;
}

// ─── Line Items ────────────────────────────────────────────────────────────────

export interface CreateLineItemDTO {
  tempId?: string;          // client-side id for batch nesting resolution
  parentTempId?: string;    // references another tempId in the same batch
  parentId?: number;        // references an already-persisted item
  name: string;
  displayName?: string;
  description?: string;
  ingredients?: string;
  image?: string;
  type: 'category' | 'item' | 'dish' | 'product' | 'service' | 'art' | 'modifier' | 'addon';
  enumType?: 'veg' | 'non-veg' | 'egg';
  isActive?: boolean;
  sortOrder?: number;
  price?: string;
  tags?: string[];
  allergens?: string[];
  isVeg?: boolean;
  spiceLevel?: number;
}

export interface UpdateLineItemDTO {
  displayName?: string;
  description?: string;
  ingredients?: string;
  image?: string;
  type?: 'category' | 'dish';
  enumType?: 'veg' | 'non-veg' | 'egg';
  isActive?: boolean;
  parentId?: number | null;
  sortOrder?: number;
  price?: string;
  tags?: string[];
  allergens?: string[];
  isVeg?: boolean;
  spiceLevel?: number;
}

export interface FlatLineItemDTO {
  id: number;
  name: string;
  displayName?: string;
  description?: string;
  ingredients?: string;
  image?: string;
  type?: string;
  enumType?: string;
  isActive: boolean;
  sortOrder?: number;
  price?: string;
  tags?: string[];
  allergens?: string[];
  isVeg?: boolean;
  spiceLevel?: number;
  parentId?: number;
  menuId: number;
  createdAt: Date;
}

// ─── Event ────────────────────────────────────────────────────────────────────

export interface CreateEventDTO {
  name: string;
  displayName: string;
  eventDescription?: string;
}

export interface UpdateEventTimingsDTO {
  startTime: Date;
  endTime: Date;
}

export interface EventSummaryWithStatusDTO {
  id: number;
  name: string;
  displayName: string;
  eventDescription?: string;
  startTime?: Date;
  endTime?: Date;
  status: string;
  amountPaid?: number;
}

// ─── Pricing ─────────────────────────────────────────────────────────────────

export interface VendorPricingConfigDTO {
  id: number;
  modelType: PricingModelType;
  amount?: number;
  currency: string;
  notes?: string;
}

// ─── Payment ─────────────────────────────────────────────────────────────────

export interface InitiatePaymentDTO {
  pricingConfigId: number;
  startTime: Date;
  durationHours: number;   // how many hours the vendor wants to activate for
}

export interface RazorpayOrderResponseDTO {
  orderId: string;
  amount: number;           // in paise (Razorpay format)
  currency: string;
  keyId: string;
}

export interface VerifyPaymentDTO {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}
