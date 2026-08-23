-- pricing_comps.provider (added nullable text in 0023) had no CHECK constraint, so it
-- could silently drift from the CompProvider union in src/types/listings.ts -- flagged by
-- anthropicreviewbot on PR #53. Mirror the pattern already used for `source`.
alter table pricing_comps drop constraint if exists pricing_comps_provider_check;
alter table pricing_comps add constraint pricing_comps_provider_check
  check (provider is null or provider = any (array[
    'soldcomps', 'ebay_browse', 'serpapi', 'poshmark_direct', 'reddit_claude', 'manual'
  ]));
