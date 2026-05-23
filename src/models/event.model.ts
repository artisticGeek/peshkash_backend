import {
  Table, Column, Model, PrimaryKey, AutoIncrement, DataType,
  CreatedAt, ForeignKey, BelongsTo, HasMany
} from 'sequelize-typescript';
import { Vendor } from './vendor.model';
import { EventMenuMapping } from './eventMenuMapping.model';

@Table({ tableName: 'event', timestamps: false })
export class Event extends Model<Event> {
  @PrimaryKey @AutoIncrement
  @Column(DataType.BIGINT)
  id!: number;

  @Column(DataType.TEXT)
  name!: string;

  @Column({ field: 'event_description', type: DataType.TEXT })
  eventDescription!: string;

  @Column({ field: 'display_name', type: DataType.TEXT })
  displayName!: string;

  @Column({ field: 'start_time', type: DataType.DATE })
  startTime?: Date;

  @Column({ field: 'end_time', type: DataType.DATE })
  endTime?: Date;

  // 'draft' until payment confirmed, 'active' once paid
  @Column({ type: DataType.STRING, defaultValue: 'active' })
  status!: string;

  @Column({ field: 'razorpay_order_id', type: DataType.STRING })
  razorpayOrderId?: string;

  @Column({ field: 'payment_id', type: DataType.STRING })
  paymentId?: string;

  @Column({ field: 'amount_paid', type: DataType.DECIMAL(10, 2) })
  amountPaid?: number;

  @CreatedAt
  @Column({ field: 'created_at' })
  createdAt!: Date;

  @ForeignKey(() => Vendor)
  @Column({ field: 'vendor_id', type: DataType.BIGINT })
  vendorId!: number;

  @BelongsTo(() => Vendor)
  vendor!: Vendor;

  @HasMany(() => EventMenuMapping)
  eventMenuMapping!: EventMenuMapping[];
}
