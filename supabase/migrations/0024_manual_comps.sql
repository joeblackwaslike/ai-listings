-- Manual comp entry: the pipeline's automated sources can miss real-world data the
-- seller already has (a private sale, an item they sold themselves), so the source
-- constraint needs a 'manual'/'manual_active' pair alongside the automated sources,
-- and listing_url must become nullable since a manually-entered comp often has no
-- URL at all (e.g. "I sold my own pair for $250, no listing exists anymore").

alter table pricing_comps alter column listing_url drop not null;

alter table pricing_comps drop constraint if exists pricing_comps_source_check;
alter table pricing_comps add constraint pricing_comps_source_check
  check (source = any (array[
    'ebay', 'poshmark', 'therealreal', 'google', 'reddit', 'mercari', 'etsy',
    'ebay_active', 'google_active', 'poshmark_active', 'therealreal_active', 'mercari_active',
    'manual', 'manual_active'
  ]));
