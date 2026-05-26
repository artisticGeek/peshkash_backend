-- Migration: 2026-05-26-menu-type-qr-event-linkage
-- Safe to run: all additions are nullable or have defaults. No existing rows break.

-- 1. Menu type classification (generic = reusable vendor template, personalized = event-specific copy)
--    + lineage tracking when a personalized menu is copied from a generic one
ALTER TABLE public.menu
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'generic'
    CHECK (type IN ('generic', 'personalized')),
  ADD COLUMN IF NOT EXISTS source_menu_id bigint REFERENCES public.menu(id);

-- 2. QR event linkage: enables auto-activate/deactivate on event publish/close
ALTER TABLE public.qr_link_mapping
  ADD COLUMN IF NOT EXISTS event_id  bigint REFERENCES public.event(id),
  ADD COLUMN IF NOT EXISTS vendor_id bigint REFERENCES public.vendor(id);

-- 3. Item uniqueness within a menu (enforce the menu+name composite key)
--    ADD CONSTRAINT doesn't support IF NOT EXISTS; use a unique index instead (equivalent).
CREATE UNIQUE INDEX IF NOT EXISTS line_item_menu_name_unique
  ON public.line_item (menu_id, name);
