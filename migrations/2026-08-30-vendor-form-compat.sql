-- Vendor editor compatibility. Safe to replay in Supabase SQL Editor.
ALTER TABLE public.vendor
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS phone varchar(20),
  ADD COLUMN IF NOT EXISTS require_login boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS vendor_phone_unique_idx
  ON public.vendor (phone)
  WHERE phone IS NOT NULL AND trim(phone) <> '';
