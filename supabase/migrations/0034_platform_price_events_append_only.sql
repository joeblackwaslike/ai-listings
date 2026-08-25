-- 0033's "Users own platform price events" policy used `for all`, which grants the listing
-- owner update and delete on platform_price_events -- defeating the point of the table, which
-- exists so future pricing intelligence can trust real historical posted prices. Flagged by
-- Sourcery/LlamaPReview on PR #54. Replace it with select + insert only; with no update/delete
-- policy, RLS denies both by default, making the table append-only.
drop policy if exists "Users own platform price events" on platform_price_events;

create policy "Users can view their platform price events" on platform_price_events
  for select using (
    exists (select 1 from listings l where l.id = listing_id and l.user_id = auth.uid())
  );

create policy "Users can insert their platform price events" on platform_price_events
  for insert with check (
    exists (select 1 from listings l where l.id = listing_id and l.user_id = auth.uid())
  );
