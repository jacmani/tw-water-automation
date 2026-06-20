-- Migration 006: Fix CHECK constraints to match app display values
-- The original migration 005 used snake_case / lowercase values but the app
-- sends human-readable display strings. This migration aligns the schema.

-- amenity_type: 'car_wash' → 'Car Wash' etc.
ALTER TABLE amenity_meter_readings
  DROP CONSTRAINT IF EXISTS amenity_meter_readings_amenity_type_check;
ALTER TABLE amenity_meter_readings
  ADD CONSTRAINT amenity_meter_readings_amenity_type_check
  CHECK (amenity_type IN ('Car Wash', 'Swimming Pool', 'Party Hall'));

-- location: 'jupiter' → 'Jupiter', 'meter_3' → 'Meter 3' etc.
ALTER TABLE amenity_meter_readings
  DROP CONSTRAINT IF EXISTS amenity_meter_readings_location_check;
ALTER TABLE amenity_meter_readings
  ADD CONSTRAINT amenity_meter_readings_location_check
  CHECK (location IN (
    'Jupiter', 'Mercury', 'Venus', 'Neptune',
    'Meter 1', 'Meter 2', 'Meter 3', 'Meter 4', 'Meter 5',
    'Meter 6', 'Meter 7', 'WTP1', 'WTP2', 'VUF', 'JUF', 'Venus STP'
  ));

-- time_slot: '06:00' → '6AM' etc.
ALTER TABLE water_level_readings
  DROP CONSTRAINT IF EXISTS water_level_readings_time_slot_check;
ALTER TABLE water_level_readings
  ADD CONSTRAINT water_level_readings_time_slot_check
  CHECK (time_slot IN ('6AM', '12PM', '6PM', '12AM'));
