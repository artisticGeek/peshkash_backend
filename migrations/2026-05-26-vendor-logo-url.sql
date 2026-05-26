-- Safe to run: nullable, no backfill needed
ALTER TABLE public.vendor
  ADD COLUMN IF NOT EXISTS logo_url text;
