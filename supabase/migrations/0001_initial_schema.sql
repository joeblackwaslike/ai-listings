-- AI Listings Platform — Initial Schema

-- No extension needed; gen_random_uuid() is built into Postgres 13+

-- SKU generation
create table sku_counters (
  category_prefix text primary key,
  next_value      integer not null default 1
);

insert into sku_counters (category_prefix) values
  ('HB'), ('CL'), ('SN'), ('EL'), ('JW'), ('CO'), ('OT');

create or replace function generate_sku(prefix text)
returns text
language plpgsql
as $$
declare
  seq integer;
begin
  update sku_counters
    set next_value = next_value + 1
    where category_prefix = prefix
    returning next_value - 1 into seq;

  if not found then
    raise exception 'Unknown SKU prefix: %', prefix;
  end if;

  return prefix || '-' || lpad(seq::text, 4, '0');
end;
$$;

-- listings
create table listings (
  id                    uuid primary key default gen_random_uuid(),
  sku                   text unique,
  status                text not null default 'intake'
                          check (status in ('intake','id_gate','in_loop','finalizing','published','archived')),
  pipeline_step         integer not null default 0,
  pipeline_total        integer not null default 5,
  title                 text,
  description           text,
  category              text
                          check (category in ('handbag','clothing','sneakers','electronics','jewelry','collectibles','other')),
  brand                 text,
  condition             text
                          check (condition in (
                            'new_with_tags','new_without_tags','like_new',
                            'very_good','good','fair','poor','for_parts'
                          )),
  condition_notes       text,
  tags                  text[] not null default '{}',
  inclusions            jsonb not null default '[]',
  suggested_price_cents integer,
  final_price_cents     integer,
  confidence_score      integer check (confidence_score between 0 and 100),
  auth_plan             jsonb not null default '[]',
  photo_plan            jsonb not null default '[]',
  platform_fields       jsonb not null default '{}',
  listing_urls          jsonb not null default '{}',
  agent_blocked         boolean not null default false,
  agent_blocked_reason  text,
  is_luxury             boolean not null default false,
  intake_meta           jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger listings_updated_at
  before update on listings
  for each row execute function set_updated_at();

-- photos
create table photos (
  id              uuid primary key default gen_random_uuid(),
  listing_id      uuid not null references listings(id) on delete cascade,
  type            text not null check (type in ('intake','processed','auth_card','studio')),
  raw_url         text not null,
  processed_url   text,
  display_order   integer not null default 0,
  photoroom_meta  jsonb,
  created_at      timestamptz not null default now()
);

create index photos_listing_id_idx on photos(listing_id);

-- pricing_comps
create table pricing_comps (
  id                    uuid primary key default gen_random_uuid(),
  listing_id            uuid not null references listings(id) on delete cascade,
  source                text not null check (source in ('ebay','poshmark','therealreal','google')),
  title                 text not null,
  sale_price_cents      integer not null,
  condition             text not null,
  sold_at               date,
  listing_url           text not null,
  condition_delta       text not null check (condition_delta in ('same','better','worse')),
  adjusted_price_cents  integer not null,
  created_at            timestamptz not null default now()
);

create index pricing_comps_listing_id_idx on pricing_comps(listing_id);

-- conversations
create table conversations (
  id                uuid primary key default gen_random_uuid(),
  listing_id        uuid not null references listings(id) on delete cascade,
  role              text not null check (role in ('user','assistant')),
  content           text not null,
  context_snapshot  jsonb,
  created_at        timestamptz not null default now()
);

create index conversations_listing_id_idx on conversations(listing_id);

-- Row-Level Security
alter table listings enable row level security;
alter table photos enable row level security;
alter table pricing_comps enable row level security;
alter table conversations enable row level security;

create policy "authenticated_full_access" on listings
  for all to authenticated using (true) with check (true);

create policy "authenticated_full_access" on photos
  for all to authenticated using (true) with check (true);

create policy "authenticated_full_access" on pricing_comps
  for all to authenticated using (true) with check (true);

create policy "authenticated_full_access" on conversations
  for all to authenticated using (true) with check (true);

-- Supabase Realtime
alter publication supabase_realtime add table listings;
