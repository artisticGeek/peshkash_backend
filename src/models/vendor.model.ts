import { Table, Column, Model, PrimaryKey, AutoIncrement, DataType, CreatedAt, HasMany } from 'sequelize-typescript';
import { Event } from './event.model';
import { Menu } from './menu.model';

@Table({ tableName: 'vendor', timestamps: false })
export class Vendor extends Model<Vendor> {
  @PrimaryKey @AutoIncrement
  @Column(DataType.BIGINT)
  id!: number;

  @Column(DataType.STRING)
  name!: string;

  @Column(DataType.TEXT)
  description?: string;

  @Column({ field: 'display_name', type: DataType.TEXT })
  displayName!: string;


  @Column(DataType.ARRAY(DataType.STRING))
  contact?: string[];

  @Column(DataType.TEXT)
  address?: string;

  @Column({ field: 'has_contact_page', type: DataType.BOOLEAN, defaultValue: false })
  hasContactPage!: boolean;

  @Column({ field: 'logo_url', type: DataType.TEXT, allowNull: true })
  logoUrl?: string;

  @Column({ field: 'phone', type: DataType.STRING(20), allowNull: true, unique: true })
  phone?: string;

  @Column({ field: 'require_login', type: DataType.BOOLEAN, defaultValue: false })
  requireLogin!: boolean;


  @CreatedAt
  @Column({ field: 'created_at' })
  createdAt!: Date;

  @HasMany(() => Event)
  events!: Event[];

  @HasMany(() => Menu)
  menus!: Menu[];
}
