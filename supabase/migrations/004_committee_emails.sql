-- Migration 004: Set email addresses for term 2026-27 Managing Committee
-- Run in the Supabase SQL editor.

UPDATE committee_members SET email = 'timborcochi@gmail.com'    WHERE name = 'Joby George'          AND term = '2026-27';
UPDATE committee_members SET email = 'anoopsekharm@gmail.com'   WHERE name = 'Anoop Sekhar'         AND term = '2026-27';
UPDATE committee_members SET email = 'mathew.varkey@gmail.com'  WHERE name = 'Varkey Mathew'        AND term = '2026-27';
UPDATE committee_members SET email = 'Sreeji.m@gmail.com'       WHERE name = 'Sreejith M'           AND term = '2026-27';
UPDATE committee_members SET email = 'mohanrajeev_05@yahoo.co.in' WHERE name = 'Rajeev K R'         AND term = '2026-27';
UPDATE committee_members SET email = 'jasonjhere@gmail.com'     WHERE name = 'Jason Joy'            AND term = '2026-27';
UPDATE committee_members SET email = 'mohammedvh@gmail.com'     WHERE name = 'Mohammad V H'         AND term = '2026-27';
UPDATE committee_members SET email = 'jayujoseph@gmail.com'     WHERE name = 'Jayash K J'           AND term = '2026-27';
UPDATE committee_members SET email = 'anjali12344@gmail.com'    WHERE name = 'Anjali Ramesh'        AND term = '2026-27';
UPDATE committee_members SET email = 'anand89030@gmail.com'     WHERE name = 'Anand Unnikrishnan'   AND term = '2026-27';
UPDATE committee_members SET email = 'jacmani@gmail.com'        WHERE name = 'Jacob Mani'           AND term = '2026-27';
UPDATE committee_members SET email = 'tgsreekanth@gmail.com'    WHERE name = 'Sreekanth'            AND term = '2026-27';

-- Verify: should return 12 rows, all with non-null emails
SELECT name, role, tower, email
FROM committee_members
WHERE term = '2026-27' AND email IS NOT NULL
ORDER BY
  CASE role
    WHEN 'President'        THEN 0
    WHEN 'Vice President'   THEN 1
    WHEN 'Secretary'        THEN 2
    WHEN 'Joint Secretary'  THEN 3
    WHEN 'Treasurer'        THEN 4
    WHEN 'Joint Treasurer'  THEN 5
    WHEN 'Technical Expert' THEN 6
    WHEN 'Financial Expert' THEN 7
    WHEN 'GC Chair'         THEN 8
    ELSE 9
  END,
  name;
