-- user_api_keys.provider's CHECK constraint predates this PR's soldcomps field in
-- ApiKeys/user-api-keys.ts and never got extended -- discovered live 2026-08-23 while
-- triaging codexreviewbot's "production deployment key is ignored" finding on PR #53: the
-- constraint was silently rejecting every attempt to store a per-user SoldComps key, so
-- production had no soldcomps row for any user and every SoldComps fetch was quietly
-- falling back to '' (isDev-only env fallback, same pattern as every other key here).
alter table user_api_keys drop constraint if exists user_api_keys_provider_check;
alter table user_api_keys add constraint user_api_keys_provider_check
  check (provider = any (array['anthropic', 'serpapi', 'withoutbg', 'soldcomps']));
