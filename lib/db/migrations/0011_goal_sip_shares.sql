-- Goal-based target building.
--
-- The old `goals.allocation_pct` was a flat slice of *today's* portfolio value
-- (portfolio x pct), which cannot separate invested from gains and silently
-- reassigns returns between goals as NAVs move. Replace it with the pair that
-- actually defines a goal's claim:
--
--   start_date     -- purchases before this date are not attributed to the goal
--   sip_share_pct  -- share of the UNITS of every SIP-active instrument's
--                     purchase on or after that date
--
-- Attributing units (not rupees) makes a goal a real sub-portfolio: units never
-- change once recorded, so invested = units x their purchase NAVs and current
-- value = units x latest NAV both fall out, and the goal slices always
-- reconcile to the instrument's true total units.
--
-- Existing rows are carried over rather than dropped: allocation_pct becomes
-- sip_share_pct and the goal is treated as having run since the first recorded
-- investment. The two percentages do not mean the same thing, so this is a
-- best-effort reinterpretation, not an equivalence -- review goals after
-- upgrading.

CREATE TABLE goals_new (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  start_date TEXT NOT NULL,
  sip_share_pct REAL NOT NULL CHECK (sip_share_pct >= 0 AND sip_share_pct <= 100),
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
  notes TEXT
) STRICT;

INSERT INTO goals_new (id, name, start_date, sip_share_pct, is_archived, notes)
  SELECT id,
         name,
         COALESCE((SELECT MIN(txn_date) FROM investment_txns), '2000-01-01'),
         allocation_pct,
         0,
         notes
  FROM goals;

DROP TABLE goals;

ALTER TABLE goals_new RENAME TO goals;
