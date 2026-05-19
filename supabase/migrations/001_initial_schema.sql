-- Trinity World Water Automation — Initial Schema
-- Run this in the Supabase SQL editor for your project.
-- Also create a storage bucket named "sheet-images" (public) in the Supabase dashboard.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────

CREATE TABLE daily_sheets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  date DATE NOT NULL,
  uploaded_by TEXT,
  image_url TEXT,
  processed_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (processed_status IN ('pending', 'processed', 'failed')),
  confidence_score DECIMAL(3,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE tower_consumption (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sheet_id UUID NOT NULL REFERENCES daily_sheets(id) ON DELETE CASCADE,
  tower TEXT NOT NULL CHECK (tower IN ('Venus', 'Mercury', 'Neptune', 'Jupiter')),
  type TEXT NOT NULL CHECK (type IN ('DO', 'DR')),
  r_yesterday DECIMAL,
  r_today DECIMAL,
  total_ltrs DECIMAL,
  vol_yesterday DECIMAL,
  vol_today DECIMAL,
  diff DECIMAL,
  confidence DECIMAL(3,2) NOT NULL DEFAULT 1.0
);

CREATE TABLE water_sources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sheet_id UUID NOT NULL REFERENCES daily_sheets(id) ON DELETE CASCADE,
  location TEXT NOT NULL,
  source_type TEXT,
  r_yesterday DECIMAL,
  r_today DECIMAL,
  yesterday_ltrs DECIMAL,
  today_ltrs DECIMAL,
  total DECIMAL
);

CREATE TABLE water_levels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sheet_id UUID NOT NULL REFERENCES daily_sheets(id) ON DELETE CASCADE,
  tank TEXT NOT NULL,
  time_slot TEXT NOT NULL CHECK (time_slot IN ('6AM', '12PM', '6PM', '12AM')),
  cm_reading DECIMAL,
  percentage DECIMAL
);

CREATE TABLE amenities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sheet_id UUID NOT NULL REFERENCES daily_sheets(id) ON DELETE CASCADE,
  section TEXT NOT NULL,
  meter_name TEXT NOT NULL,
  y_day DECIMAL,
  r_day DECIMAL,
  diff DECIMAL
);

CREATE TABLE summary (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sheet_id UUID NOT NULL REFERENCES daily_sheets(id) ON DELETE CASCADE,
  v_side DECIMAL,
  n_side DECIMAL,
  jtr_tanker DECIMAL,
  mtr_tanker DECIMAL,
  input_total DECIMAL,
  tower_usage DECIMAL,
  diff DECIMAL
);

-- ─────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────

CREATE INDEX idx_daily_sheets_date ON daily_sheets(date);
CREATE INDEX idx_tower_consumption_sheet_id ON tower_consumption(sheet_id);
CREATE INDEX idx_tower_consumption_tower ON tower_consumption(tower);
CREATE INDEX idx_water_sources_sheet_id ON water_sources(sheet_id);
CREATE INDEX idx_water_levels_sheet_id ON water_levels(sheet_id);
CREATE INDEX idx_amenities_sheet_id ON amenities(sheet_id);
CREATE INDEX idx_summary_sheet_id ON summary(sheet_id);

-- ─────────────────────────────────────────
-- Row Level Security (v1: permissive, no auth)
-- Water consumption data is not sensitive — it's shared community data.
-- Auth enforcement comes in v2.
-- ─────────────────────────────────────────

ALTER TABLE daily_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE tower_consumption ENABLE ROW LEVEL SECURITY;
ALTER TABLE water_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE water_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE amenities ENABLE ROW LEVEL SECURITY;
ALTER TABLE summary ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_all_daily_sheets" ON daily_sheets FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "public_all_tower_consumption" ON tower_consumption FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "public_all_water_sources" ON water_sources FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "public_all_water_levels" ON water_levels FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "public_all_amenities" ON amenities FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "public_all_summary" ON summary FOR ALL TO anon USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────
-- Storage (run separately or via Supabase dashboard)
-- ─────────────────────────────────────────
-- Create a public bucket named "sheet-images" in the Supabase dashboard.
-- Or run:
--   INSERT INTO storage.buckets (id, name, public) VALUES ('sheet-images', 'sheet-images', true);
--   CREATE POLICY "public_upload" ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id = 'sheet-images');
--   CREATE POLICY "public_read" ON storage.objects FOR SELECT TO anon USING (bucket_id = 'sheet-images');
