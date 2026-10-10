import {
  Table,
  Column,
  Model,
  PrimaryKey,
  AutoIncrement,
  DataType,
  ForeignKey,
  BelongsTo,
  HasMany,
  CreatedAt,
} from 'sequelize-typescript';
import { Vendor } from './vendor.model';
import { LineItem } from './lineItem.model';

@Table({
  tableName: 'menu',
  timestamps: false,
})
export class Menu extends Model<Menu> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  id!: number;

  @Column(DataType.STRING)
  name!: string;

  @Column({ field: 'display_name', type: DataType.TEXT })
  displayName!: string;

  @Column(DataType.TEXT)
  description?: string;

  @Column({ field: 'item_story_heading', type: DataType.STRING(80), defaultValue: 'The backstory' })
  itemStoryHeading!: string;

  @Column({ field: 'item_material_heading', type: DataType.STRING(80), defaultValue: 'Material' })
  itemMaterialHeading!: string;

  @Column({ field: 'elaborate_descriptions', type: DataType.BOOLEAN, defaultValue: false })
  elaborateDescriptions!: boolean;

  @Column({ field: 'is_active', type: DataType.BOOLEAN })
  isActive!: boolean;

  /** Default item-page CTAs for every item in this menu. See utils/CtaConfigUtil. */
  @Column({ field: 'cta_config', type: DataType.JSONB, defaultValue: {} })
  ctaConfig!: Record<string, unknown>;

  /** Unsaved Menu Studio working copy ({ menu, items, savedAt }); null when the menu has no draft. */
  @Column({ field: 'draft', type: DataType.JSONB, allowNull: true })
  draft?: Record<string, unknown> | null;

  @Column({ field: 'draft_saved_at', type: DataType.DATE, allowNull: true })
  draftSavedAt?: Date | null;

  @CreatedAt
  @Column({ field: 'created_at' })
  createdAt!: Date;

  @ForeignKey(() => Vendor)
  @Column({ field: 'vendor_id', type: DataType.BIGINT })
  vendorId!: number;

  @Column({ type: DataType.TEXT, defaultValue: 'generic' })
  type!: string;

  @ForeignKey(() => Menu)
  @Column({ field: 'source_menu_id', type: DataType.BIGINT })
  sourceMenuId?: number;

  @BelongsTo(() => Menu, { foreignKey: 'sourceMenuId', as: 'sourceMenu' })
  sourceMenu?: Menu;

  @BelongsTo(() => Vendor)
  vendor!: Vendor;

  @HasMany(() => LineItem, { foreignKey: 'menuId' })
  lineItems!: LineItem[];
}
