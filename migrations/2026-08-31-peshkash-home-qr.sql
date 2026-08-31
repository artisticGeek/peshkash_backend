-- Attribute the permanent Peshkash landing-page QR to ArtisticGeek Studios.
-- Idempotent: safe to run again after deploys or database restores.
DO $$
DECLARE
  artisticgeek_vendor_id bigint;
BEGIN
  SELECT id
    INTO artisticgeek_vendor_id
    FROM public.vendor
   WHERE name = 'artisticgeek-studios'
   LIMIT 1;

  IF artisticgeek_vendor_id IS NULL THEN
    RAISE NOTICE 'Peshkash home QR not created: vendor artisticgeek-studios does not exist';
    RETURN;
  END IF;

  UPDATE public.qr_link_mapping
     SET url = '/',
         type = 'static',
         vendor_id = artisticgeek_vendor_id,
         event_id = NULL,
         is_active = true,
         expires_at = NULL,
         updated_at = now()
   WHERE qr_hash = 'peshkash-home';

  IF NOT FOUND THEN
    INSERT INTO public.qr_link_mapping
      (qr_hash, url, type, vendor_id, event_id, is_active, usage_count, created_at, updated_at)
    VALUES
      ('peshkash-home', '/', 'static', artisticgeek_vendor_id, NULL, true, 0, now(), now());
  END IF;
END $$;
