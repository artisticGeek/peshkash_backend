-- Peshkash 4.0 Menu Studio: configurable item-page CTAs.
-- menu.cta_config holds the defaults every item inherits ({} = built-ins on, no custom CTAs).
-- line_item.cta_config is an optional per-item override (NULL = inherit the menu default).
-- Safe to replay. runMigrations() in src/app.ts also applies this on boot.
ALTER TABLE public.menu
  ADD COLUMN IF NOT EXISTS cta_config jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.line_item
  ADD COLUMN IF NOT EXISTS cta_config jsonb NULL;
