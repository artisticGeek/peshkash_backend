-- Explicit menu ordering for the drag-and-drop designer. Safe to replay.
ALTER TABLE public.line_item
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS price text,
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS allergens text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS is_veg boolean,
  ADD COLUMN IF NOT EXISTS spice_level integer;

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY menu_id, parent_id
           ORDER BY created_at, id
         ) - 1 AS next_order
  FROM public.line_item
)
UPDATE public.line_item item
SET sort_order = ranked.next_order
FROM ranked
WHERE ranked.id = item.id
  AND item.sort_order = 0;

CREATE INDEX IF NOT EXISTS line_item_menu_parent_order_idx
  ON public.line_item (menu_id, parent_id, sort_order, id);
