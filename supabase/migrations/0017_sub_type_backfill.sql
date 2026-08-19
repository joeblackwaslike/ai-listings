-- Backfill sub_type for existing listings using the same regex patterns as
-- detectClothingSubType/detectJewelrySubType (src/lib/utils.ts,
-- src/lib/jewelry-detection.ts). Only touches rows that are currently NULL,
-- so it's safe to re-run.
-- Scoped to clothing/jewelry categories only; other categories have no sub_type mapping
-- and are left untouched.
WITH model_lines AS (
  SELECT
    id,
    category,
    lower(
      regexp_replace(
        (SELECT value FROM jsonb_array_elements_text(intake_meta->'visionAnalysis'->'notable_features') AS value WHERE value LIKE 'Model:%' LIMIT 1),
        '^Model:\s*', ''
      )
    ) AS model
  FROM listings
  WHERE sub_type IS NULL AND category IN ('clothing', 'jewelry')
)
UPDATE listings l
SET sub_type = CASE
  WHEN m.category = 'clothing' AND m.model ~ '\yjeans?\y|denim|\y5[0-9][0-9]\y' THEN 'jeans'
  WHEN m.category = 'clothing' AND m.model ~ '\yshorts?\y' THEN 'shorts'
  WHEN m.category = 'clothing' AND m.model ~ 'formal.*pant|dress.*pant|trousers?|slacks?' THEN 'pants_formal'
  WHEN m.category = 'clothing' AND m.model ~ '\ypants?\y|\ychinos?\y|\ykhakis?\y' THEN 'pants'
  WHEN m.category = 'clothing' AND m.model ~ 't.?shirt|tee\y|crew.?neck' THEN 'tshirt'
  WHEN m.category = 'clothing' AND m.model ~ '\yshirt\y|button.?down|oxford|polo|dress\s+shirt' THEN 'shirt'
  WHEN m.category = 'clothing' AND m.model ~ '\ydress\y' THEN 'dress'
  WHEN m.category = 'clothing' AND m.model ~ 'jacket|blazer|\ycoat\y|hoodie|sweatshirt' THEN 'jacket'
  WHEN m.category = 'clothing' AND m.model ~ '\yskirt\y' THEN 'skirt'
  WHEN m.category = 'jewelry' AND m.model ~ '\yring\y' THEN 'ring'
  WHEN m.category = 'jewelry' AND m.model ~ '\ybangle\y' THEN 'bangle'
  WHEN m.category = 'jewelry' AND m.model ~ '\ybracelet\y' THEN 'bracelet'
  WHEN m.category = 'jewelry' AND m.model ~ '\ynecklace\y' THEN 'necklace'
  WHEN m.category = 'jewelry' AND m.model ~ '\yearrings?\y' THEN 'earrings'
  WHEN m.category = 'jewelry' AND m.model ~ '\ypendant\y' THEN 'pendant'
  WHEN m.category = 'jewelry' AND m.model ~ '\ybrooch\y' THEN 'brooch'
  ELSE NULL
END
FROM model_lines m
WHERE l.id = m.id AND m.model IS NOT NULL;
