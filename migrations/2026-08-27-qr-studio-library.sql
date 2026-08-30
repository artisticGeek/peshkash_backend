BEGIN;

ALTER TABLE qr_templates ADD COLUMN IF NOT EXISTS library_template_id TEXT;
ALTER TABLE qr_templates ADD COLUMN IF NOT EXISTS manifest_version TEXT NOT NULL DEFAULT '3.1.0';
ALTER TABLE qr_templates ADD COLUMN IF NOT EXISTS qr_style TEXT NOT NULL DEFAULT 'obsidian-ring';
ALTER TABLE qr_templates ADD COLUMN IF NOT EXISTS theme TEXT NOT NULL DEFAULT 'light';
ALTER TABLE qr_templates ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE qr_templates DROP CONSTRAINT IF EXISTS qr_templates_qr_style_check;
ALTER TABLE qr_templates ADD CONSTRAINT qr_templates_qr_style_check
  CHECK (qr_style IN ('obsidian-ring', 'porcelain-cameo'));

ALTER TABLE qr_templates DROP CONSTRAINT IF EXISTS qr_templates_theme_check;
ALTER TABLE qr_templates ADD CONSTRAINT qr_templates_theme_check
  CHECK (theme IN ('light', 'dark'));

COMMIT;
