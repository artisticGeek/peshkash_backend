-- A dashboard phone may be associated with more than one vendor workspace.
-- Keep the existing vendor.phone association model; only remove uniqueness.
ALTER TABLE public.vendor DROP CONSTRAINT IF EXISTS vendor_phone_key;
DROP INDEX IF EXISTS public.vendor_phone_unique_idx;

CREATE INDEX IF NOT EXISTS vendor_phone_idx
  ON public.vendor (phone)
  WHERE phone IS NOT NULL AND trim(phone) <> '';
