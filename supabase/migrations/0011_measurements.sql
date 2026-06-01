-- Add structured measurement fields to support category-appropriate attribute collection
-- clothing_sub_type: jeans, pants, pants_formal, shorts, tshirt, shirt, dress, jacket, skirt, other
-- measurements: JSONB for waist/inseam/chest/sleeve/length/bust/hips/height/width/depth/weight_oz/us_size/rise
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS clothing_sub_type TEXT,
  ADD COLUMN IF NOT EXISTS measurements JSONB;
