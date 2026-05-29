-- Migration: 001_create_analytics_event
-- Append-only event log for product analytics.
-- Run once against the Supabase PostgreSQL instance.

CREATE TABLE IF NOT EXISTS analytics_event (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Discriminator: 'qr_scan' | 'action'
  event_type   VARCHAR(30)  NOT NULL,

  -- Granular label for 'action' rows; NULL for 'qr_scan' rows
  action_type  VARCHAR(50),

  -- QR tracking
  qr_hash      TEXT,
  qr_type      VARCHAR(20),    -- 'event' | 'static' | 'vendor' | 'item'
  qr_status    VARCHAR(20),    -- 'active' | 'inactive' | 'expired' | 'not_found'
  resolved     BOOLEAN DEFAULT TRUE,
  resolved_url TEXT,

  -- Business object context (denormalized for fast GROUP BY)
  vendor_id    BIGINT,
  event_id     BIGINT,
  menu_id      BIGINT,
  item_id      BIGINT,

  -- Client metadata
  device_type  VARCHAR(20),    -- 'mobile' | 'desktop' | 'tablet' | 'unknown'
  user_agent   TEXT,
  referrer     TEXT
);

-- Query performance indexes
CREATE INDEX IF NOT EXISTS idx_ae_created_at ON analytics_event (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ae_event_type ON analytics_event (event_type);
CREATE INDEX IF NOT EXISTS idx_ae_vendor_id  ON analytics_event (vendor_id);
CREATE INDEX IF NOT EXISTS idx_ae_event_id   ON analytics_event (event_id);
CREATE INDEX IF NOT EXISTS idx_ae_qr_hash    ON analytics_event (qr_hash);
CREATE INDEX IF NOT EXISTS idx_ae_item_id    ON analytics_event (item_id);
