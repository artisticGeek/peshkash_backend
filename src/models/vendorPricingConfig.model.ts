import {
  Table, Column, Model, PrimaryKey, AutoIncrement, DataType,
  ForeignKey, BelongsTo, CreatedAt,
} from 'sequelize-typescript';
import { Vendor } from './vendor.model';

export type PricingModelType = 'per_event' | 'per_month' | 'per_year' | 'package' | 'custom';

@Table({ tableName: 'vendor_pricing_config', timestamps: false })
export class VendorPricingConfig extends Model<VendorPricingConfig> {
  @PrimaryKey @AutoIncrement
  @Column(DataType.BIGINT)
  id!: number;

  @ForeignKey(() => Vendor)
  @Column({ field: 'vendor_id', type: DataType.BIGINT })
  vendorId!: number;

  @BelongsTo(() => Vendor)
  vendor!: Vendor;

  @Column({ field: 'model_type', type: DataType.STRING })
  modelType!: PricingModelType;

  // Optional flat amount per activation (can be null for fully-custom arrangements)
  @Column({ type: DataType.DECIMAL(10, 2) })
  amount?: number;

  @Column({ type: DataType.STRING, defaultValue: 'INR' })
  currency!: string;

  @Column({ type: DataType.TEXT })
  notes?: string;

  @Column({ field: 'is_active', type: DataType.BOOLEAN, defaultValue: true })
  isActive!: boolean;

  @CreatedAt
  @Column({ field: 'created_at' })
  createdAt!: Date;
}
