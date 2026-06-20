-- Migration 006: Fix CHECK constraints to match app values
-- amenity_type was 'car_wash'/'swimming_pool' but app sends 'Car Wash'/'Swimming Pool'
-- time_slot was '06:00'/'12:00' etc but app sends '6AM'/'12PM' etc

ALTER TABLE amenity_meter_readings
  DROP CONSTRAINT IF EXISTS amenity_meter_readings_amenity_type_check;

ALTER TABLE amenity_meter_readings
  ADD CONSTRAINT amenity_meter_readings_amenity_type_check
  CHECK (amenity_type IN ('Car Wash', 'Swimming Pool', 'Party Hall'));

ALTER TABLE water_level_readings
  DROP CONSTRAINT IF EXISTS water_level_readings_time_slot_check;

ALTER TABLE water_level_readings
  ADD CONSTRAINT water_level_readings_time_slot_check
  CHECK (time_slot IN ('6AM', '12PM', '6PM', '12AM'));
