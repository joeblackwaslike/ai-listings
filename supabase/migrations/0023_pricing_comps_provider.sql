-- Tracks which underlying API/data provider produced a comp row (SoldComps, SerpAPI,
-- eBay's official Browse API, Poshmark's direct cookie-authenticated fetch, Reddit+Claude
-- extraction), separate from `source` (which platform the comp is FROM: eBay, Poshmark,
-- TheRealReal, etc.). Needed because a single `source` value like 'ebay_active' can come
-- from two different providers (the official Browse API, or the SerpAPI fallback) with no
-- way to tell them apart without this -- requested to audit which data sources are
-- actually working in production.
ALTER TABLE pricing_comps ADD COLUMN IF NOT EXISTS provider text;
