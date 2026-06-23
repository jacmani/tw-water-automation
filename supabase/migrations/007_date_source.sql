-- Migration 007: Add date_source column to daily_sheets
-- Tracks whether the date was read by AI or entered manually by the user.
-- 'ai'     = Claude Vision read the date with high confidence
-- 'manual' = User entered the date because AI couldn't read it clearly

ALTER TABLE daily_sheets
  ADD COLUMN IF NOT EXISTS date_source TEXT NOT NULL DEFAULT 'ai'
  CHECK (date_source IN ('ai', 'manual'));

-- Back-fill existing rows (all pre-migration sheets were AI-read)
UPDATE daily_sheets SET date_source = 'ai' WHERE date_source IS NULL;
