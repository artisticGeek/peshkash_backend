import {
  Table, Column, Model, PrimaryKey, AutoIncrement, DataType,
  CreatedAt, ForeignKey, BelongsTo,
} from 'sequelize-typescript';
import { Event } from './event.model';
import { Vendor } from './vendor.model';

@Table({ tableName: 'qr_link_mapping', timestamps: false })
export class QrLinkMapping extends Model<QrLinkMapping> {
  @PrimaryKey @AutoIncrement
  @Column(DataType.BIGINT)
  id!: number;

  @CreatedAt
  @Column({ field: 'created_at' })
  createdAt!: Date;

  @Column({ field: 'qr_hash', type: DataType.TEXT })
  qrHash?: string;

  @Column(DataType.TEXT)
  url?: string;

  @Column({ field: 'updated_at', type: DataType.DATE })
  updatedAt?: Date;

  @Column({ field: 'is_active', type: DataType.BOOLEAN })
  isActive?: boolean;

  @Column({ field: 'usage_count', type: DataType.INTEGER })
  usageCount?: number;

  @Column({ field: 'expires_at', type: DataType.DATE })
  expiresAt?: Date;

  @ForeignKey(() => Event)
  @Column({ field: 'event_id', type: DataType.BIGINT })
  eventId?: number;

  @BelongsTo(() => Event)
  event?: Event;

  @ForeignKey(() => Vendor)
  @Column({ field: 'vendor_id', type: DataType.BIGINT })
  vendorId?: number;

  @BelongsTo(() => Vendor)
  vendor?: Vendor;
}
