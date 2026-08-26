alter table listings
  add column if not exists photo_plan_generated_at timestamptz;
