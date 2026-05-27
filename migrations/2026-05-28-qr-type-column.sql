-- Add 'type' column to qr_link_mapping for dynamic event-based QR resolution.
-- 'static'  = legacy behaviour, redirect uses the stored url field
-- 'event'   = dynamic, resolves to the event's current linked menu at scan time
-- 'vendor'  = (future) dynamic vendor card resolution
ALTER TABLE qr_link_mapping
  ADD COLUMN IF NOT EXISTS type VARCHAR(20) NOT NULL DEFAULT 'static';
