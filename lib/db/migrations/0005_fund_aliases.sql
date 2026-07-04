-- Broker exports name the same scheme differently ("Motilal Oswal Midcap Fund
-- Direct Growth" vs "MOTILAL OSWAL MIDCAP DIR GR"), and Groww exports carry no
-- ISIN at all — so instrument identity needs learned name aliases, exactly
-- like party_aliases does for payees. Confirmed scheme→fund mappings from the
-- import review are stored here and auto-match on the next import.

CREATE TABLE fund_aliases (
  id INTEGER PRIMARY KEY,
  fund_id INTEGER NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
  alias TEXT NOT NULL UNIQUE   -- normalized scheme name
) STRICT;
CREATE INDEX idx_fund_aliases_fund ON fund_aliases(fund_id);
