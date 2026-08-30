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
import { Menu } from './menu.model';

@Table({
  tableName: 'line_item',
  timestamps: false,
})
export class LineItem extends Model<LineItem> {
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

  @Column(DataType.TEXT)
  ingredients?: string;

  @Column(DataType.TEXT)
  image?: string;

  @Column(DataType.TEXT)
  type?: string;

  @Column({ field: 'enum_type', type: DataType.STRING })
  enumType?: string;

  @Column({ field: 'is_active', type: DataType.BOOLEAN })
  isActive!: boolean;

  @Column({ field: 'sort_order', type: DataType.INTEGER, defaultValue: 0 })
  sortOrder!: number;

  @Column(DataType.TEXT)
  price?: string;

  @Column({ type: DataType.ARRAY(DataType.TEXT), defaultValue: [] })
  tags?: string[];

  @Column({ type: DataType.ARRAY(DataType.TEXT), defaultValue: [] })
  allergens?: string[];

  @Column({ field: 'is_veg', type: DataType.BOOLEAN })
  isVeg?: boolean;

  @Column({ field: 'spice_level', type: DataType.INTEGER })
  spiceLevel?: number;

  @CreatedAt
  @Column({ field: 'created_at' })
  createdAt!: Date;

  @ForeignKey(() => Menu)
  @Column({ field: 'menu_id', type: DataType.BIGINT })
  menuId!: number;

  @BelongsTo(() => Menu)
  menu!: Menu;

  @ForeignKey(() => LineItem)
  @Column({ field: 'parent_id', type: DataType.BIGINT })
  parentId?: number;

  @BelongsTo(() => LineItem, { foreignKey: 'parentId', as: 'parent' })
  parent?: LineItem;

  @HasMany(() => LineItem, { foreignKey: 'parentId', as: 'children' })
  children?: LineItem[];
}
