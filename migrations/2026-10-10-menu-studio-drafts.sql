-- Peshkash 4.0 Menu Studio: drafts.
-- menu.draft holds the studio's unsaved working copy ({ menu, items, savedAt }) so vendors can
-- keep editing privately. Guests keep seeing the live line items until the draft is saved.
-- Safe to replay. runMigrations() in src/app.ts also applies this on boot.
ALTER TABLE public.menu
  ADD COLUMN IF NOT EXISTS draft jsonb NULL;

ALTER TABLE public.menu
  ADD COLUMN IF NOT EXISTS draft_saved_at timestamptz NULL;
