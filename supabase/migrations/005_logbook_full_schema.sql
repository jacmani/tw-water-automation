-- Migration 005: Full log book schema
-- New tables use log_date DATE as the primary key for each entry.
-- These are independent of daily_sheets/sheet_id — they support manual data entry.
-- Run in the Supabase SQL editor after migration 004.

-- ─────────────────────────────────────────
-- 1. daily_log (master record per date)
-- ─────────────────────────────────────────

CREATE TABLE daily_log (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  log_date        DATE        NOT NULL UNIQUE,
  technician_name TEXT,
  fm_signed       BOOLEAN     NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_daily_log_date ON daily_log(log_date DESC);

-- ─────────────────────────────────────────
-- 2. tower_meter_readings
-- ─────────────────────────────────────────

CREATE TABLE tower_meter_readings (
  id                    UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  log_date              DATE    NOT NULL REFERENCES daily_log(log_date) ON DELETE CASCADE,
  tower                 TEXT    NOT NULL CHECK (tower IN ('Venus', 'Mercury', 'Neptune', 'Jupiter')),
  meter_type            TEXT    NOT NULL CHECK (meter_type IN ('DO', 'DR')),
  yesterday_reading     NUMERIC,
  today_reading         NUMERIC,
  total_in_ltrs         NUMERIC,
  consumption_yesterday NUMERIC,
  consumption_today     NUMERIC,
  difference            NUMERIC,
  UNIQUE (log_date, tower, meter_type)
);

CREATE INDEX idx_tower_meter_log_date ON tower_meter_readings(log_date);

-- ─────────────────────────────────────────
-- 3. input_source_readings
-- ─────────────────────────────────────────

CREATE TABLE input_source_readings (
  id                    UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  log_date              DATE    NOT NULL REFERENCES daily_log(log_date) ON DELETE CASCADE,
  source_name           TEXT    NOT NULL CHECK (source_name IN (
    'mercury_venus_tanker',
    'jupiter_neptune_tanker',
    'venus_side_well_123',
    'venus_side_well_4',
    'neptune_side_well_5',
    'neptune_side_well_6',
    'open_well'
  )),
  yesterday_reading     NUMERIC,
  today_reading         NUMERIC,
  consumption_yesterday NUMERIC,
  consumption_today     NUMERIC,
  total                 NUMERIC,
  UNIQUE (log_date, source_name)
);

CREATE INDEX idx_input_source_log_date ON input_source_readings(log_date);

-- ─────────────────────────────────────────
-- 4. amenity_meter_readings
-- ─────────────────────────────────────────

CREATE TABLE amenity_meter_readings (
  id            UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  log_date      DATE    NOT NULL REFERENCES daily_log(log_date) ON DELETE CASCADE,
  amenity_type  TEXT    NOT NULL CHECK (amenity_type IN ('car_wash', 'swimming_pool')),
  location      TEXT    NOT NULL CHECK (location IN (
    'jupiter', 'mercury', 'venus', 'neptune',
    'meter_1', 'meter_2', 'meter_3'
  )),
  yesterday     NUMERIC,
  today         NUMERIC,
  consumption   NUMERIC,
  cumulative    NUMERIC,
  UNIQUE (log_date, amenity_type, location)
);

CREATE INDEX idx_amenity_meter_log_date ON amenity_meter_readings(log_date);

-- ─────────────────────────────────────────
-- 5. water_level_readings
-- ─────────────────────────────────────────

CREATE TABLE water_level_readings (
  id               UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  log_date         DATE    NOT NULL REFERENCES daily_log(log_date) ON DELETE CASCADE,
  time_slot        TEXT    NOT NULL CHECK (time_slot IN ('06:00', '12:00', '18:00', '00:00')),
  jupiter_do       NUMERIC,
  jupiter_dr       NUMERIC,
  collection_tank  NUMERIC,
  mercury_do       NUMERIC,
  mercury_dr       NUMERIC,
  cumulative_j     NUMERIC,
  cumulative_m     NUMERIC,
  cumulative_v     NUMERIC,
  cumulative_n     NUMERIC,
  cumulative_total NUMERIC,
  UNIQUE (log_date, time_slot)
);

CREATE INDEX idx_water_level_log_date ON water_level_readings(log_date);

-- ─────────────────────────────────────────
-- 6. utility_meter_readings
-- ─────────────────────────────────────────

CREATE TABLE utility_meter_readings (
  id                    UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  log_date              DATE    NOT NULL REFERENCES daily_log(log_date) ON DELETE CASCADE UNIQUE,
  p_hall_meter_1        NUMERIC,
  p_hall_meter_2        NUMERIC,
  wtp_1                 NUMERIC,
  wtp_2                 NUMERIC,
  venus_side_uf         NUMERIC,
  total_tankers         NUMERIC,
  consumption_yesterday NUMERIC,
  consumption_today     NUMERIC,
  consumption_total     NUMERIC
);

-- ─────────────────────────────────────────
-- 7. daily_inflow_summary
-- ─────────────────────────────────────────

CREATE TABLE daily_inflow_summary (
  id                          UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  log_date                    DATE    NOT NULL REFERENCES daily_log(log_date) ON DELETE CASCADE UNIQUE,
  water_inflow                NUMERIC,
  well_inflow                 NUMERIC,
  tanker_inflow               NUMERIC,
  total_collection            NUMERIC,
  total_usage                 NUMERIC,
  balance                     NUMERIC,
  cumulative_water            NUMERIC,
  cumulative_well             NUMERIC,
  cumulative_tanker           NUMERIC,
  cumulative_total_collection NUMERIC,
  cumulative_total_usage      NUMERIC,
  cumulative_balance          NUMERIC
);

-- ─────────────────────────────────────────
-- RLS — permissive anon access (matches existing tables)
-- ─────────────────────────────────────────

ALTER TABLE daily_log                ENABLE ROW LEVEL SECURITY;
ALTER TABLE tower_meter_readings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE input_source_readings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE amenity_meter_readings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE water_level_readings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE utility_meter_readings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_inflow_summary     ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read_daily_log"    ON daily_log                FOR SELECT TO anon USING (true);
CREATE POLICY "public_write_daily_log"   ON daily_log                FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "public_update_daily_log"  ON daily_log                FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "public_read_tower_meters"   ON tower_meter_readings   FOR SELECT TO anon USING (true);
CREATE POLICY "public_write_tower_meters"  ON tower_meter_readings   FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "public_update_tower_meters" ON tower_meter_readings   FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "public_read_input_sources"   ON input_source_readings FOR SELECT TO anon USING (true);
CREATE POLICY "public_write_input_sources"  ON input_source_readings FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "public_update_input_sources" ON input_source_readings FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "public_read_amenity_meters"   ON amenity_meter_readings FOR SELECT TO anon USING (true);
CREATE POLICY "public_write_amenity_meters"  ON amenity_meter_readings FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "public_update_amenity_meters" ON amenity_meter_readings FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "public_read_water_levels"   ON water_level_readings   FOR SELECT TO anon USING (true);
CREATE POLICY "public_write_water_levels"  ON water_level_readings   FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "public_update_water_levels" ON water_level_readings   FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "public_read_utility_meters"   ON utility_meter_readings FOR SELECT TO anon USING (true);
CREATE POLICY "public_write_utility_meters"  ON utility_meter_readings FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "public_update_utility_meters" ON utility_meter_readings FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "public_read_inflow_summary"   ON daily_inflow_summary   FOR SELECT TO anon USING (true);
CREATE POLICY "public_write_inflow_summary"  ON daily_inflow_summary   FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "public_update_inflow_summary" ON daily_inflow_summary   FOR UPDATE TO anon USING (true) WITH CHECK (true);
