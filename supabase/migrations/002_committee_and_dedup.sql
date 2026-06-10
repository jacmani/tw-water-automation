-- Migration 002: Committee registry + duplicate-sheet deduplication
-- Run in the Supabase SQL editor BEFORE deploying the updated application code.

-- ─────────────────────────────────────────
-- 1. Add superseded column to daily_sheets
-- ─────────────────────────────────────────

ALTER TABLE daily_sheets
  ADD COLUMN superseded BOOLEAN NOT NULL DEFAULT false;

-- For each date with multiple sheets, mark all but the most-recently-created
-- as superseded. The most recent upload per date becomes the canonical record.
WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (PARTITION BY date ORDER BY created_at DESC) AS rn
  FROM daily_sheets
)
UPDATE daily_sheets
SET superseded = true
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE INDEX idx_daily_sheets_superseded ON daily_sheets(superseded);

-- ─────────────────────────────────────────
-- 2. committee_members table
-- ─────────────────────────────────────────

CREATE TABLE committee_members (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  term         TEXT        NOT NULL,
  name         TEXT        NOT NULL,
  role         TEXT        NOT NULL,
  tower        TEXT        CHECK (tower IN ('Venus', 'Mercury', 'Neptune', 'Jupiter')),
  apartment    TEXT,
  phone        TEXT,
  email        TEXT,
  whatsapp_optin BOOLEAN   NOT NULL DEFAULT true,
  active       BOOLEAN     NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_committee_members_term   ON committee_members(term);
CREATE INDEX idx_committee_members_active ON committee_members(active);

ALTER TABLE committee_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_committee"  ON committee_members FOR SELECT TO anon USING (true);
CREATE POLICY "public_write_committee" ON committee_members FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "public_update_committee" ON committee_members FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────
-- 3. Seed — term 2026-27 (24 members)
-- ─────────────────────────────────────────

INSERT INTO committee_members (term, name, role, tower, apartment) VALUES
  ('2026-27', 'Joby George',         'President',       'Jupiter', '10B'),
  ('2026-27', 'Anoop Sekhar',        'Vice President',  'Venus',   '3D'),
  ('2026-27', 'Varkey Mathew',       'Secretary',       'Neptune', '14A'),
  ('2026-27', 'Sreejith M',          'Joint Secretary', 'Mercury', '12G'),
  ('2026-27', 'Rajeev K R',          'Treasurer',       'Mercury', '15E'),
  ('2026-27', 'Jason Joy',           'Joint Treasurer', 'Neptune', '14G'),
  ('2026-27', 'Mohammad V H',        'Technical Expert','Jupiter', '4A'),
  ('2026-27', 'Jayash K J',          'Financial Expert','Venus',   '2A'),
  ('2026-27', 'Anjali Ramesh',       'GC Chair',        'Jupiter', '13A'),
  ('2026-27', 'Anand Unnikrishnan',  'GC Chair',        'Neptune', '17E'),
  ('2026-27', 'Jacob Mani',          'GC Chair',        'Venus',   '2H'),
  ('2026-27', 'Sreekanth',           'GC Chair',        'Mercury', '16E'),
  ('2026-27', 'Prakash Chandra',     'GC Member',       'Jupiter', '5G'),
  ('2026-27', 'Jim Thomas',          'GC Member',       'Jupiter', '15G'),
  ('2026-27', 'Nikhil E',            'GC Member',       'Jupiter', '3E'),
  ('2026-27', 'Reghu Menon',         'GC Member',       'Neptune', '4D'),
  ('2026-27', 'Murli Ravisankar',    'GC Member',       'Neptune', '14H'),
  ('2026-27', 'Jacob Thomas',        'GC Member',       'Neptune', '21A'),
  ('2026-27', 'Ajith Kumar',         'GC Member',       'Venus',   '3I'),
  ('2026-27', 'Rani Chacko',         'GC Member',       'Venus',   '4A'),
  ('2026-27', 'Tito Alex',           'GC Member',       'Venus',   '5K'),
  ('2026-27', 'Susan Thomas',        'GC Member',       'Mercury', '6M'),
  ('2026-27', 'Hruseesh Damu',       'GC Member',       'Mercury', '4G'),
  ('2026-27', 'Binoy Chandrasekhar', 'GC Member',       'Mercury', '22J');
