export interface LineItemDTO {
  id: number;
  name: string;
  displayName?: string;
  description?: string;
  isActive: boolean;
  createdAt: Date;
  itemType: string;
  enumType?: string;
  image?: string | null;
  sortOrder?: number;
  price?: string;
  tags?: string[];
  allergens?: string[];
  isVeg?: boolean;
  spiceLevel?: number;
  subCategoryLineItems?: LineItemDTO[];
}
