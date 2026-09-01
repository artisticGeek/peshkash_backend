export interface VendorSummaryDTO {
  id: number;
  name: string;
  displayName: string;
  description?: string;
  contact?: string[];
  address?: string;
  logoUrl?: string | null;
  hasContactPage?: boolean;
  /** If true, customers must log in before seeing this vendor's pages */
  requireLogin?: boolean;
}
