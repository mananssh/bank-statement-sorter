-- Soft reimbursement support ("group expense paybacks").
--
-- A friend's payback is tagged straight to the expense head(s) it repays and
-- NETS against them in every report (expense totals = debits − credits).
-- txn_splits lets one incoming credit be allocated across several categories
-- (one Splitwise-style settlement covering food + travel + tickets). When a
-- txn has splits, reports use the splits instead of its single category.
--
-- reimbursement_links optionally tie a payback to the original payment txns —
-- purely an audit trail (useful at tax time), amounts are not required to match.

CREATE TABLE txn_splits (
  id INTEGER PRIMARY KEY,
  txn_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0)
) STRICT;
CREATE INDEX idx_txn_splits_txn ON txn_splits(txn_id);

CREATE TABLE reimbursement_links (
  id INTEGER PRIMARY KEY,
  credit_txn_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  debit_txn_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (credit_txn_id, debit_txn_id)
) STRICT;
CREATE INDEX idx_reimb_links_credit ON reimbursement_links(credit_txn_id);
CREATE INDEX idx_reimb_links_debit ON reimbursement_links(debit_txn_id);
