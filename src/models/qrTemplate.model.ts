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

  @CreatedAt
  @Column({ field: 'created_at' })
  createdAt!: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  updatedAt!: Date;
}
