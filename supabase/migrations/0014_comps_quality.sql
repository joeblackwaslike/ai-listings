-- Comps quality round (PR1): lowest-active intelligence + comp color/relevance,
-- and widen the comp source constraint to cover the active-market variants the
-- pipeline already emits (latent bug: active inserts violated the old constraint
-- once platform creds were present).

alter table listings
  add column if not exists lowest_active_price_cents integer,
  add column if not exists lowest_active_url text,
  add column if not exists lowest_active_source text;

alter table pricing_comps
  add column if not exists color text,
  add column if not exists relevance_score smallint;

alter table pricing_comps drop constraint if exists pricing_comps_source_check;
alter table pricing_comps add constraint pricing_comps_source_check
  check (source = any (array[
    'ebay', 'poshmark', 'therealreal', 'google', 'reddit', 'mercari', 'etsy',
    'ebay_active', 'google_active', 'poshmark_active', 'therealreal_active', 'mercari_active'
  ]));
