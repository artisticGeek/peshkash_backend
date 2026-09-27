-- Reusable Print Studio jobs. Safe to replay in Supabase SQL Editor.
create table if not exists public.print_collections (
  id bigint generated always as identity primary key,
  name text not null,
  event_id bigint references public.event(id) on delete cascade,
  vendor_id bigint references public.vendor(id) on delete cascade,
  configuration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists print_collections_event_id_idx on public.print_collections(event_id);
create index if not exists print_collections_vendor_id_idx on public.print_collections(vendor_id);
