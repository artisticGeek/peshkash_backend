import {
  Table, Column, Model, PrimaryKey, AutoIncrement, DataType,
  CreatedAt, UpdatedAt,
} from 'sequelize-typescript';

@Table({ tableName: 'print_collections', timestamps: true, underscored: true })
export class PrintCollection extends Model<PrintCollection> {
  @PrimaryKey @AutoIncrement
  @Column(DataType.BIGINT)
  id!: number;

  @Column({ type: DataType.TEXT, allowNull: false })
  name!: string;

  @Column({ field: 'event_id', type: DataType.BIGINT, allowNull: true })
  eventId!: number | null;

  @Column({ field: 'vendor_id', type: DataType.BIGINT, allowNull: true })
  vendorId!: number | null;

  @Column({ type: DataType.JSONB, allowNull: false, defaultValue: {} })
  configuration!: Record<string, unknown>;

  @Column({ type: DataType.TEXT, allowNull: true })
  notes!: string | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  remarks!: string | null;

  @CreatedAt
  @Column({ field: 'created_at' })
  createdAt!: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  updatedAt!: Date;
}
