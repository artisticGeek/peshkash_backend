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

  @Column({ field: 'library_template_id', type: DataType.TEXT, allowNull: true })
  libraryTemplateId!: string | null;

  @Column({ field: 'manifest_version', type: DataType.TEXT, allowNull: false, defaultValue: '3.1.0' })
  manifestVersion!: string;

  @Column({ field: 'qr_style', type: DataType.TEXT, allowNull: false, defaultValue: 'obsidian-ring' })
  qrStyle!: 'obsidian-ring' | 'porcelain-cameo';

  @Column({ type: DataType.TEXT, allowNull: false, defaultValue: 'light' })
  theme!: 'light' | 'dark';

  @Column({ type: DataType.JSONB, allowNull: false, defaultValue: {} })
  settings!: Record<string, unknown>;

  @Column({ field: 'schema_version', type: DataType.TEXT, allowNull: false, defaultValue: '1.0.0' })
  schemaVersion!: string;

  @Column({ type: DataType.JSONB, allowNull: true })
  document!: Record<string, unknown> | null;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 1 })
  revision!: number;

  @Column({ field: 'preview_thumbnail', type: DataType.TEXT, allowNull: true })
  previewThumbnail!: string | null;

  @CreatedAt
  @Column({ field: 'created_at' })
  createdAt!: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  updatedAt!: Date;
}
