-- Full-text search over transactions (external-content FTS5 table + sync triggers).

CREATE VIRTUAL TABLE txn_fts USING fts5(
  narration, description, counterparty_raw,
  content='transactions', content_rowid='id'
);

CREATE TRIGGER txn_fts_ai AFTER INSERT ON transactions BEGIN
  INSERT INTO txn_fts(rowid, narration, description, counterparty_raw)
  VALUES (new.id, new.narration, new.description, new.counterparty_raw);
END;

CREATE TRIGGER txn_fts_ad AFTER DELETE ON transactions BEGIN
  INSERT INTO txn_fts(txn_fts, rowid, narration, description, counterparty_raw)
  VALUES ('delete', old.id, old.narration, old.description, old.counterparty_raw);
END;

CREATE TRIGGER txn_fts_au AFTER UPDATE ON transactions BEGIN
  INSERT INTO txn_fts(txn_fts, rowid, narration, description, counterparty_raw)
  VALUES ('delete', old.id, old.narration, old.description, old.counterparty_raw);
  INSERT INTO txn_fts(rowid, narration, description, counterparty_raw)
  VALUES (new.id, new.narration, new.description, new.counterparty_raw);
END;
