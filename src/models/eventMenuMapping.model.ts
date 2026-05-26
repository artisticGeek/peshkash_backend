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

// NOTE: display_name exists in the service layer via hasEventMenuDisplayNameColumn() guard.
// It is intentionally NOT declared as a @Column here so that Sequelize does not attempt to
// SELECT display_name when the DB column is absent. Once the migration
// "2026-05-26-event-menu-display-name.sql" has been applied, add it back.

@Table({
  tableName: 'event_menu_mapping',
  timestamps: false,
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
