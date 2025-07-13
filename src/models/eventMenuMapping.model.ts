import {
  Table,
  Column,
  Model,
  ForeignKey,
  BelongsTo,
  DataType,
} from 'sequelize-typescript';
import { Event } from './event.model';
import { Menu } from './menu.model';

@Table({
  tableName: 'event_menu_mapping',
  timestamps: false, // or true if you're using `created_at`
})
export class EventMenuMapping extends Model<EventMenuMapping> {
  @ForeignKey(() => Event)
  @Column({
    field: 'event_id',
    type: DataType.BIGINT,
  })
  eventId!: number;

  @ForeignKey(() => Menu)
  @Column({
    field: 'menu_id',
    type: DataType.BIGINT,
  })
  menuId!: number;

  @Column({
    field: 'created_at',
    type: DataType.DATE,
  })
  createdAt!: Date;

  @BelongsTo(() => Event)
  event!: Event;

  @BelongsTo(() => Menu)
  menu!: Menu;
}
