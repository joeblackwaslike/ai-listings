ALTER TABLE listings DROP CONSTRAINT listings_status_check;
ALTER TABLE listings ADD CONSTRAINT listings_status_check
  CHECK (status = ANY (ARRAY[
    'intake','id_gate','gender_gate','in_loop',
    'condition_gate',
    'finalizing','published','archived'
  ]));
