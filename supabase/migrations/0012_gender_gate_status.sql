ALTER TABLE listings
  DROP CONSTRAINT IF EXISTS listings_status_check;

ALTER TABLE listings
  ADD CONSTRAINT listings_status_check
  CHECK (status = ANY (ARRAY[
    'intake'::text,
    'id_gate'::text,
    'gender_gate'::text,
    'in_loop'::text,
    'finalizing'::text,
    'published'::text,
    'archived'::text
  ]));
