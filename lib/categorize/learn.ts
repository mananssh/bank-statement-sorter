import "server-only";
import type { Database } from "better-sqlite3";
import { payeeKey, normalizePayee } from "@/lib/categorize/keys";

export interface ConfirmedTxn {
  account_id: number;
  narration: string;
  counterparty_raw: string | null;
  counterparty_vpa: string | null;
  category_id: number;
  party_id: number | null;
  /** what the resolver had suggested, to detect corrections */
  suggested_category_id: number | null;
}

/**
 * Learning write path, called inside the commit transaction. Every committed
 * categorized row teaches the memory layer; a correction (user overrode the
 * suggestion) replaces the bad mapping so one fix wins next time. Parties are
 * auto-created from the parsed counterparty when no alias matches yet.
 */
export function recordConfirmation(db: Database, txn: ConfirmedTxn): { party_id: number | null } {
  const key = payeeKey(txn);
  let partyId = txn.party_id;

  if (key && !partyId && txn.counterparty_raw) {
    partyId = ensureParty(db, txn.counterparty_raw, key, txn.category_id);
  } else if (key && partyId) {
    // Make sure this key is an alias of the chosen party.
    db.prepare(
      `INSERT INTO party_aliases (party_id, alias_key) VALUES (?, ?)
       ON CONFLICT(alias_key) DO NOTHING`,
    ).run(partyId, key);
  }

  if (key) {
    const corrected =
      txn.suggested_category_id !== null && txn.suggested_category_id !== txn.category_id;
    if (corrected) {
      // Replace the stale mapping outright instead of letting hit counts fight.
      db.prepare(`DELETE FROM narration_memory WHERE key = ? AND account_id IN (0, ?)`).run(
        key,
        txn.account_id,
      );
    }
    db.prepare(
      `INSERT INTO narration_memory (key, account_id, category_id, party_id)
       VALUES (?, 0, ?, ?)
       ON CONFLICT(key, account_id) DO UPDATE SET
         category_id = excluded.category_id,
         party_id = COALESCE(excluded.party_id, narration_memory.party_id),
         hit_count = hit_count + 1,
         last_confirmed_at = datetime('now')`,
    ).run(key, txn.category_id, partyId);
  }

  return { party_id: partyId };
}

/** Find-or-create a party for a parsed counterparty name + alias key. */
export function ensureParty(
  db: Database,
  counterpartyRaw: string,
  aliasKey: string,
  defaultCategoryId: number | null,
): number {
  const existing = db
    .prepare(`SELECT party_id FROM party_aliases WHERE alias_key = ?`)
    .get(aliasKey) as { party_id: number } | undefined;
  if (existing) return existing.party_id;

  // Identity is the alias key (UPI handle), NOT the display name — two distinct
  // people can share a name, so never merge on name. Always create a new party
  // for an unseen key; the user can merge parties manually if needed.
  const canonical = toTitleCase(normalizePayee(counterpartyRaw)) || counterpartyRaw.trim();
  const partyId = Number(
    db
      .prepare(`INSERT INTO parties (canonical_name, default_category_id) VALUES (?, ?)`)
      .run(canonical, defaultCategoryId).lastInsertRowid,
  );

  db.prepare(
    `INSERT INTO party_aliases (party_id, alias_key) VALUES (?, ?)
     ON CONFLICT(alias_key) DO NOTHING`,
  ).run(partyId, aliasKey);

  return partyId;
}

function toTitleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
