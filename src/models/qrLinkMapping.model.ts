import {
  Table, Column, Model, PrimaryKey, AutoIncrement, DataType,
  CreatedAt
} from 'sequelize-typescript';

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
}
