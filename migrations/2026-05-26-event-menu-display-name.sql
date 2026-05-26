-- Migration: 2026-05-26-event-menu-display-name
-- Adds optional display_name override per event-menu mapping.
-- Safe to run at any time: nullable, no backfill required.

ALTER TABLE public.event_menu_mapping
  ADD COLUMN IF NOT EXISTS display_name text;
