import {
  Table, Column, Model, PrimaryKey, AutoIncrement, DataType, CreatedAt,
} from 'sequelize-typescript';

/**
 * analytics_event — append-only log for all trackable product events.
 *
 * event_type values:  'qr_scan' | 'action'
 * action_type values: 'whatsapp_click' | 'call_click' | 'email_click' |
 *                     'directions_click' | 'share_click' | 'save_contact' |
 *                     'social_click' | 'item_expand' | 'vendor_contact_view'
 * device_type values: 'mobile' | 'desktop' | 'tablet' | 'unknown'
 * qr_status values:   'active' | 'inactive' | 'expired' | 'not_found'
 */
@Table({ tableName: 'analytics_event', timestamps: false })
export class AnalyticsEvent extends Model<AnalyticsEvent> {
  @PrimaryKey @AutoIncrement
  @Column(DataType.BIGINT)
  id!: number;

  @CreatedAt
  @Column({ field: 'created_at', type: DataType.DATE, defaultValue: DataType.NOW })
  createdAt!: Date;

  // 'qr_scan' | 'action'
  @Column({ field: 'event_type', type: DataType.STRING(30), allowNull: false })
  eventType!: string;

  // granular action label, null for qr_scan rows
  @Column({ field: 'action_type', type: DataType.STRING(50), allowNull: true })
  actionType?: string;

  // QR hash that triggered the scan (null for pure action events)
  @Column({ field: 'qr_hash', type: DataType.TEXT, allowNull: true })
  qrHash?: string;

  // 'event' | 'static' | 'vendor' | 'item'
  @Column({ field: 'qr_type', type: DataType.STRING(20), allowNull: true })
  qrType?: string;

  // 'active' | 'inactive' | 'expired' | 'not_found'
  @Column({ field: 'qr_status', type: DataType.STRING(20), allowNull: true })
  qrStatus?: string;

  @Column({ field: 'resolved', type: DataType.BOOLEAN, defaultValue: true })
  resolved?: boolean;

  @Column({ field: 'resolved_url', type: DataType.TEXT, allowNull: true })
  resolvedUrl?: string;

  @Column({ field: 'vendor_id', type: DataType.BIGINT, allowNull: true })
  vendorId?: number;

  @Column({ field: 'event_id', type: DataType.BIGINT, allowNull: true })
  eventId?: number;

  @Column({ field: 'menu_id', type: DataType.BIGINT, allowNull: true })
  menuId?: number;

  @Column({ field: 'item_id', type: DataType.BIGINT, allowNull: true })
  itemId?: number;

  // 'mobile' | 'desktop' | 'tablet' | 'unknown'
  @Column({ field: 'device_type', type: DataType.STRING(20), allowNull: true })
  deviceType?: string;

  @Column({ field: 'user_agent', type: DataType.TEXT, allowNull: true })
  userAgent?: string;

  @Column({ field: 'referrer', type: DataType.TEXT, allowNull: true })
  referrer?: string;

  @Column({ field: 'page_url', type: DataType.TEXT, allowNull: true })
  pageUrl?: string;

  @Column({ field: 'phone', type: DataType.STRING(20), allowNull: true })
  phone?: string;

  // Client-held UUID (localStorage), tagged on every event before and after login.
  // Resolved to a phone at read time via a join against device_link — never backfilled here.
  @Column({ field: 'device_id', type: DataType.UUID, allowNull: true })
  deviceId?: string;

  @Column({ field: 'os', type: DataType.STRING(30), allowNull: true })
  os?: string;

  // Browser name + major version and a coarse device label — both parsed from the same
  // User-Agent header already used for deviceType/os, so no new client permission or field.
  @Column({ field: 'browser', type: DataType.STRING(60), allowNull: true })
  browser?: string;

  @Column({ field: 'device_name', type: DataType.STRING(60), allowNull: true })
  deviceName?: string;
}
