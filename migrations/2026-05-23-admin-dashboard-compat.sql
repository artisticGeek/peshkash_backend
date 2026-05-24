-- Peshkash admin dashboard compatibility migration
-- Reviewed against backup-current-schema-2026-05-23.sql.
-- Run in Supabase SQL Editor.
--
-- Purpose:
-- 1. Add event activation/payment fields expected by the current Sequelize model.
-- 2. Add safe defaults where the current schema has NOT NULL booleans without defaults.
-- 3. Backfill empty display names so admin tables/forms are readable.
-- 4. Add uniqueness indexes used by admin duplicate prevention, but skip them with
--    NOTICEs instead of failing if existing duplicate data needs cleanup first.

begin;

-- The live schema is only missing these Event model columns.
alter table public.event
  add column if not exists status text not null default 'active',
  add column if not exists razorpay_order_id text,
  add column if not exists payment_id text,
  add column if not exists amount_paid numeric(10, 2);

alter table public.event_menu_mapping
  add column if not exists display_name text;

update public.event_menu_mapping emm
set display_name = m.display_name
from public.menu m
where emm.menu_id = m.id
  and nullif(trim(coalesce(emm.display_name, '')), '') is null;

alter table public.event
  drop constraint if exists event_status_check;

alter table public.event
  add constraint event_status_check
  check (status in ('draft', 'active', 'inactive'));

-- Keep display names usable for existing rows where the old default inserted ''.
update public.vendor
set display_name = name
where nullif(trim(display_name), '') is null;

update public.event
set display_name = name
where nullif(trim(display_name), '') is null;

update public.menu
set display_name = name
where nullif(trim(display_name), '') is null;

update public.line_item
set display_name = name
where nullif(trim(display_name), '') is null;

-- Match admin create behavior and avoid future inserts failing on omitted booleans.
alter table public.menu
  alter column is_active set default true;

alter table public.line_item
  alter column is_active set default true;

alter table public.qr_link_mapping
  alter column updated_at set default now(),
  alter column is_active set default true,
  alter column usage_count set default 0;

-- Uniqueness/indexes. These are intentionally conditional so existing duplicate
-- data does not abort the whole migration.
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'vendor_name_unique_idx'
  ) then
    if not exists (
      select 1
      from public.vendor
      group by name
      having count(*) > 1
    ) then
      create unique index vendor_name_unique_idx on public.vendor (name);
    else
      raise notice 'Skipped vendor_name_unique_idx because duplicate vendor.name values exist.';
    end if;
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'event_vendor_name_unique_idx'
  ) then
    if not exists (
      select 1
      from public.event
      where vendor_id is not null
      group by vendor_id, name
      having count(*) > 1
    ) then
      create unique index event_vendor_name_unique_idx
        on public.event (vendor_id, name)
        where vendor_id is not null;
    else
      raise notice 'Skipped event_vendor_name_unique_idx because duplicate event slugs exist for at least one vendor.';
    end if;
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'menu_vendor_name_unique_idx'
  ) then
    if not exists (
      select 1
      from public.menu
      where vendor_id is not null
      group by vendor_id, name
      having count(*) > 1
    ) then
      create unique index menu_vendor_name_unique_idx
        on public.menu (vendor_id, name)
        where vendor_id is not null;
    else
      raise notice 'Skipped menu_vendor_name_unique_idx because duplicate menu slugs exist for at least one vendor.';
    end if;
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'line_item_menu_name_unique_idx'
  ) then
    if not exists (
      select 1
      from public.line_item
      where menu_id is not null
      group by menu_id, name
      having count(*) > 1
    ) then
      create unique index line_item_menu_name_unique_idx
        on public.line_item (menu_id, name)
        where menu_id is not null;
    else
      raise notice 'Skipped line_item_menu_name_unique_idx because duplicate item slugs exist for at least one menu.';
    end if;
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'event_menu_mapping_unique_idx'
  ) then
    if not exists (
      select 1
      from public.event_menu_mapping
      group by event_id, menu_id
      having count(*) > 1
    ) then
      create unique index event_menu_mapping_unique_idx
        on public.event_menu_mapping (event_id, menu_id);
    else
      raise notice 'Skipped event_menu_mapping_unique_idx because duplicate event/menu links exist.';
    end if;
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'qr_link_mapping_hash_unique_idx'
  ) then
    if not exists (
      select 1
      from public.qr_link_mapping
      where qr_hash is not null
      group by qr_hash
      having count(*) > 1
    ) then
      create unique index qr_link_mapping_hash_unique_idx
        on public.qr_link_mapping (qr_hash)
        where qr_hash is not null;
    else
      raise notice 'Skipped qr_link_mapping_hash_unique_idx because duplicate QR hashes exist.';
    end if;
  end if;
end $$;

commit;
