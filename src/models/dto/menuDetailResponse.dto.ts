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
  subCategoryLineItems?: LineItemDTO[];
}