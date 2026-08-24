-- Retail ("brand-new equivalent") comps never became pricing_comps rows -- step3 wrote a
-- single auto-picked winner as scalar listings columns (retail_price_cents/source/promo_note)
-- with no URL captured at all, so the user had no way to see which candidates were considered,
-- what was rejected, or click through to verify the one price shown. Confirmed 2026-08-24 (user
-- report: "almost all" retail comps looked questionable) -- a raw Google Shopping keyword
-- search returns loosely-related same-brand products (step3-pricing-research.ts's own
-- fetchRetailCandidates comment documents this: a Louis Vuitton search returned a dozen
-- different LV products), and picking the CHEAPEST one that merely passed relevance scoring
-- means a single wrongly-matched cheap item beats every correctly-matched one, every time.
--
-- retail_price_url mirrors the existing lowest_active_url/lowest_active_source pattern so the
-- headline retail price can link out too, not just the newly-visible comp rows.
alter table listings add column if not exists retail_price_url text;

alter table pricing_comps drop constraint if exists pricing_comps_source_check;
alter table pricing_comps add constraint pricing_comps_source_check
  check (source = any (array[
    'ebay', 'poshmark', 'therealreal', 'google', 'reddit', 'mercari', 'etsy', 'retail',
    'ebay_active', 'google_active', 'poshmark_active', 'therealreal_active', 'mercari_active',
    'manual', 'manual_active'
  ]));
