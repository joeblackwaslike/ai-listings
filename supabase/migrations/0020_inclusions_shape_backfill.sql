-- Backfill listings.inclusions rows from the pre-taxonomy shape {item, notes, included} to the
-- new shape {item, source, confirmed, notes} introduced by ai-listings-kks. Without this, every
-- reader that switched to i.confirmed (finalizing-checklist.hasIncludedBox, agent/tools'
-- buildDescription, step4a-draft-listing) treats every pre-existing inclusion as unconfirmed
-- (undefined is falsy), silently dropping 117 real production listings' box/dust-bag/card data
-- from box-measurement gating and generated descriptions (chatgpt-codex-connector / greptile-apps
-- review findings on PR #47, confirmed against production: 117/119 listings have non-empty
-- inclusions in the legacy shape).
--
-- A legacy `included: true` item becomes source='detected', confirmed=true -- the pre-taxonomy
-- pipeline had no manual/detected distinction, these were all AI-observed, and `true` already
-- represents a positive determination. A legacy `included: false` item becomes confirmed=false
-- (not dropped), so it still surfaces as a pending item to confirm or reject in the redesigned
-- FieldsPanel rather than silently vanishing.
--
-- Idempotent and safe to re-run at any time relative to app deployment: transforms only the
-- individual array elements still in the legacy shape (no `confirmed` key), leaving any element
-- that already has `confirmed` untouched -- including its tagState/docSource -- rather than
-- rebuilding the whole array from the legacy formula. A row with a mix of legacy and already
-- new-shape elements (e.g. one manually confirmed via the app's PATCH route before this
-- migration ran) previously had its already-confirmed elements silently reset to
-- confirmed=false and source='detected' by a row-level rebuild; per-element transform closes
-- that gap (greptile-apps review on PR #47, second pass).
update listings
set inclusions = (
  select jsonb_agg(
    case
      when elem ? 'confirmed' then elem
      else jsonb_build_object(
        'item', elem->>'item',
        'source', 'detected',
        'confirmed', coalesce((elem->>'included')::boolean, false),
        'notes', elem->'notes'
      )
    end
  )
  from jsonb_array_elements(inclusions) as elem
)
where inclusions is not null
  and jsonb_array_length(inclusions) > 0
  and exists (
    select 1
    from jsonb_array_elements(inclusions) as elem
    where elem ? 'included' and not (elem ? 'confirmed')
  );
