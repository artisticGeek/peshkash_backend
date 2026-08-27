import {
  Table, Column, Model, PrimaryKey, AutoIncrement, DataType,
  CreatedAt, UpdatedAt,
} from 'sequelize-typescript';

@Table({ tableName: 'qr_templates', timestamps: true, underscored: true })
export class QrTemplate extends Model<QrTemplate> {
  @PrimaryKey @AutoIncrement
  @Column(DataType.BIGINT)
  id!: number;

  @Column({ type: DataType.TEXT, allowNull: false })
  name!: string;

  @Column({ field: 'width_mm', type: DataType.FLOAT, allowNull: false, defaultValue: 85 })
  widthMm!: number;

  @Column({ field: 'height_mm', type: DataType.FLOAT, allowNull: false, defaultValue: 54 })
  heightMm!: number;

  @Column({ type: DataType.JSONB, allowNull: false, defaultValue: [] })
  elements!: object[];

  @Column({ field: 'vendor_id', type: DataType.BIGINT, allowNull: true })
  vendorId!: number | null;

  @Column({ type: DataType.JSONB, allowNull: true })
  settings!: object | null;

  @Column({ field: 'library_template_id', type: DataType.TEXT, allowNull: true })
  libraryTemplateId!: string | null;

  @Column({ field: 'qr_style', type: DataType.TEXT, allowNull: true })
  qrStyle!: string | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  theme!: string | null;

  @CreatedAt
  @Column({ field: 'created_at' })
  createdAt!: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  updatedAt!: Date;
}
