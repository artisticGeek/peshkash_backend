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

  @Column({ field: 'is_active', type: DataType.BOOLEAN })
  isActive!: boolean;

  @CreatedAt
  @Column({ field: 'created_at' })
  createdAt!: Date;

  @ForeignKey(() => Vendor)
  @Column({ field: 'vendor_id', type: DataType.BIGINT })
  vendorId!: number;

  @BelongsTo(() => Vendor)
  vendor!: Vendor;

  @HasMany(() => LineItem, { foreignKey: 'menuId' })
  lineItems!: LineItem[];
}
