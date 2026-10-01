-- Read-only, phone-bound print collection sharing. Safe to replay.
begin;

alter table public.print_collections add column if not exists notes text;
alter table public.print_collections add column if not exists remarks text;

create table if not exists public.print_collection_share (
  id bigint generated always as identity primary key,
  collection_id bigint not null references public.print_collections(id) on delete cascade,
  phone varchar(20) not null,
  token uuid not null unique,
  artworks jsonb not null default '[]'::jsonb,
  created_by varchar(20) not null,
  created_at timestamptz not null default now(),
  unique(collection_id, phone)
);

create index if not exists idx_print_collection_share_phone on public.print_collection_share(phone);

commit;
