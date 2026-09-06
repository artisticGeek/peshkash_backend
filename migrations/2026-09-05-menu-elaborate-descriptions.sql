-- Per-menu toggle: show item thumbnail + price + tags on the public menu list
-- (elaborate view) instead of just a truncated description (compact view). Safe to replay.
ALTER TABLE public.menu
  ADD COLUMN IF NOT EXISTS elaborate_descriptions boolean NOT NULL DEFAULT false;
