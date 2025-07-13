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

  @CreatedAt
  @Column({ field: 'created_at' })
  createdAt!: Date;

  @HasMany(() => Event)
  events!: Event[];

  @HasMany(() => Menu)
  menus!: Menu[];
}
