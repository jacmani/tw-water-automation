-- 010_template_sync.sql
-- Sync DB schema with the physical Trinity World Water Consumption Log Book template.
--
-- Changes:
--   1. amenities.cumulative — Car Wash and Swimming Pool sections have a
--      CUMULATIVE row on the printed template. This column stores the
--      running/monthly cumulative consumption per meter.
--
-- Note: No column renames for existing location/meter_name values — existing
-- rows (with legacy names like 'M+V DO with MTR') are preserved as-is.
-- New uploads will use template-exact names (e.g. 'Mercury + Venus Tanker').

ALTER TABLE amenities
  ADD COLUMN IF NOT EXISTS cumulative DECIMAL;

COMMENT ON COLUMN amenities.cumulative IS
  'Running cumulative consumption (from CUMULATIVE row on template). Populated for Car Wash and Swimming Pool sections only.';
