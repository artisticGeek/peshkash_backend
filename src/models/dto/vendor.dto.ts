export interface VendorSummaryDTO {
  id: number;
  name: string;
  displayName: string;
  description?: string;
  contact?: string[];
  address?: string;
  logoUrl?: string | null;
  hasContactPage?: boolean;
  contactPageMode?: 'classic' | 'editorial' | 'lookbook' | 'programme' | 'shopfront';
  contactPageConfig?: Record<string, unknown>;
  /** If true, customers must log in before seeing this vendor's pages */
  requireLogin?: boolean;
}
