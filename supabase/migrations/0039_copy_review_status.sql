ALTER TABLE listings DROP CONSTRAINT listings_status_check;
ALTER TABLE listings ADD CONSTRAINT listings_status_check CHECK (status = ANY (ARRAY['intake'::text, 'id_gate'::text, 'gender_gate'::text, 'in_loop'::text, 'condition_gate'::text, 'copy_review'::text, 'finalizing'::text, 'published'::text, 'archived'::text]));

