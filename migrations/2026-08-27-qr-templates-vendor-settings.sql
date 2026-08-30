-- Add vendor scoping and studio settings blob to qr_templates
ALTER TABLE public.qr_templates
  ADD COLUMN IF NOT EXISTS vendor_id BIGINT REFERENCES public.vendor(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS settings  JSONB,
  ADD COLUMN IF NOT EXISTS library_template_id TEXT,
  ADD COLUMN IF NOT EXISTS qr_style  TEXT,
  ADD COLUMN IF NOT EXISTS theme     TEXT;

CREATE INDEX IF NOT EXISTS idx_qr_templates_vendor_id ON public.qr_templates(vendor_id);
