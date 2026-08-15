-- Rename clothing_sub_type to sub_type: this column is about to be populated
-- for jewelry too (ring/bangle/necklace), not just clothing. A separate,
-- later migration backfills existing rows, since clothing_sub_type has been
-- read in four places (step4a, FieldsPanel, agent/tools.ts, gate-messages.ts)
-- but written nowhere in the app -- confirmed via live query, 1 of 108
-- listings has a non-null value. detectClothingSubType only needs
-- notable_features, which every listing already has, so a full backfill is
-- safe and cheap.
ALTER TABLE listings RENAME COLUMN clothing_sub_type TO sub_type;
