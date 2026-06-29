-- 008_summary_inflow_columns.sql
-- Realign the summary table to the sheet's actual bottom "TOTAL INFLOW" table, which
-- has columns: WATER | WELL | TANKER | TOTAL COLLECTION | TOTAL USAGE | BALANCE.
--
-- The legacy fields v_side / n_side / jtr_tanker / mtr_tanker did NOT match any real
-- column on the sheet, so the extractor mislabeled tanker/well values (e.g. the JTR
-- water-source total landing in mtr_tanker). We add the three columns that DO match
-- the sheet. input_total / tower_usage / diff already map cleanly to
-- TOTAL COLLECTION / TOTAL USAGE / BALANCE and are kept as-is so History flagging,
-- CSV export and the dashboard keep working.
--
-- Additive only — no data loss. Legacy columns are retained (now nullable, unused for
-- new uploads) so existing rows and History queries continue to function.

ALTER TABLE summary
  ADD COLUMN IF NOT EXISTS water_inflow   DECIMAL,
  ADD COLUMN IF NOT EXISTS well_inflow    DECIMAL,
  ADD COLUMN IF NOT EXISTS tanker_inflow  DECIMAL;

COMMENT ON COLUMN summary.water_inflow  IS 'TOTAL INFLOW table — WATER column';
COMMENT ON COLUMN summary.well_inflow   IS 'TOTAL INFLOW table — WELL column';
COMMENT ON COLUMN summary.tanker_inflow IS 'TOTAL INFLOW table — TANKER column';
COMMENT ON COLUMN summary.input_total   IS 'TOTAL INFLOW table — TOTAL COLLECTION column';
COMMENT ON COLUMN summary.tower_usage   IS 'TOTAL INFLOW table — TOTAL USAGE column';
COMMENT ON COLUMN summary.diff          IS 'TOTAL INFLOW table — BALANCE column';
