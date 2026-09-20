-- Device identity linking (pre-login analytics -> phone, resolved at read time)
-- and admin section-based permissions. Run in Supabase SQL Editor.
-- All statements are additive/idempotent; safe to re-run.

begin;

create table if not exists admin_section_grant (
  phone   varchar(20) not null,
  section varchar(30) not null,
  primary key (phone, section)
);

-- Seed every existing admin with full access so this ships as a no-behavior-change
-- baseline (an empty grants table would otherwise 403 every current admin).
insert into admin_section_grant (phone, section)
select phone, s from admin_user,
  unnest(array['vendors','events','designer','qr','qr-templates','resources','insights','sessions']) s
on conflict do nothing;

create table if not exists device_link (
  device_id     uuid primary key,
  phone         varchar(20),
  first_seen_at timestamptz not null default now(),
  linked_at     timestamptz,
  last_seen_at  timestamptz not null default now()
);
create index if not exists idx_device_link_phone on device_link(phone);

alter table analytics_event add column if not exists device_id uuid;
alter table analytics_event add column if not exists os varchar(30);
create index if not exists idx_analytics_event_device_id on analytics_event(device_id);
alter table analytics_event add column if not exists browser varchar(60);
alter table analytics_event add column if not exists device_name varchar(60);

commit;
