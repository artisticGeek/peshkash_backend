export interface LineItemDTO {
  id: number;
  name: string;
  description?: string;
  isActive: boolean;
  createdAt: Date;
  itemType: string;
  enumType?: string;
  subCategoryLineItems?: LineItemDTO[];
}