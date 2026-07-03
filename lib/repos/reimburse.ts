import "server-only";
import { db } from "@/lib/db/client";
import type { TransactionRow } from "@/lib/db/types";

/**
 * Soft reimbursement model. A payback credit can be split across the expense
 * heads it repays (txn_splits) and optionally linked to the original payment
 * txns (reimbursement_links) as a tax-time audit trail. Nothing is strict:
 * links don't have to balance, and splits are optional (a single-head payback
 * is just a normally-tagged credit).
 */

export interface SplitPortion {
  category_id: number;
  amount_paise: number;
}

export function getTxnSplits(txnId: number): SplitPortion[] {
  return db()
    .prepare(`SELECT category_id, amount_paise FROM txn_splits WHERE txn_id = ? ORDER BY id`)
    .all(txnId) as SplitPortion[];
}

/**
 * Replace a txn's splits. Portions must sum to the txn amount (the whole
 * payment has to land somewhere). Empty array clears the split. The txn's own
 * category becomes the largest portion's head so single-category views and
 * exports still show something sensible; reports use the splits.
 */
export function setTxnSplits(txnId: number, portions: SplitPortion[]): void {
  const conn = db();
  const txn = conn.prepare(`SELECT * FROM transactions WHERE id = ?`).get(txnId) as
    | TransactionRow
    | undefined;
  if (!txn) throw new Error("Transaction not found");

  if (portions.length > 0) {
    const sum = portions.reduce((s, p) => s + p.amount_paise, 0);
    if (sum !== txn.amount_paise) {
      throw new Error("Split portions must add up to the transaction amount.");
    }
  }

  const tx = conn.transaction(() => {
    conn.prepare(`DELETE FROM txn_splits WHERE txn_id = ?`).run(txnId);
    if (portions.length > 0) {
      const insert = conn.prepare(
        `INSERT INTO txn_splits (txn_id, category_id, amount_paise) VALUES (?, ?, ?)`,
      );
      for (const p of portions) insert.run(txnId, p.category_id, p.amount_paise);

      const primary = [...portions].sort((a, b) => b.amount_paise - a.amount_paise)[0];
      conn
        .prepare(
          `UPDATE transactions SET category_id = ?, categorized_by = 'manual' WHERE id = ?`,
        )
        .run(primary.category_id, txnId);
    }
  });
  tx();
}

export function getReimbursementLinks(creditTxnId: number): number[] {
  return (
    db()
      .prepare(`SELECT debit_txn_id FROM reimbursement_links WHERE credit_txn_id = ?`)
      .all(creditTxnId) as Array<{ debit_txn_id: number }>
  ).map((r) => r.debit_txn_id);
}

export function setReimbursementLinks(creditTxnId: number, debitTxnIds: number[]): void {
  const conn = db();
  const tx = conn.transaction(() => {
    conn.prepare(`DELETE FROM reimbursement_links WHERE credit_txn_id = ?`).run(creditTxnId);
    const insert = conn.prepare(
      `INSERT INTO reimbursement_links (credit_txn_id, debit_txn_id) VALUES (?, ?)
       ON CONFLICT(credit_txn_id, debit_txn_id) DO NOTHING`,
    );
    for (const id of debitTxnIds) insert.run(creditTxnId, id);
  });
  tx();
}

export interface CandidateDebit {
  id: number;
  txn_date: string;
  amount_paise: number;
  display: string;
  category_name: string | null;
  linked: boolean;
}

/**
 * Debits this payback plausibly repays: recent money-out, preferring the same
 * party, then same categories, newest first. Purely a convenience list — the
 * user can link any subset or none.
 */
export function candidateDebits(creditTxnId: number, categoryIds: number[]): CandidateDebit[] {
  const conn = db();
  const credit = conn.prepare(`SELECT * FROM transactions WHERE id = ?`).get(creditTxnId) as
    | TransactionRow
    | undefined;
  if (!credit) return [];

  const linked = new Set(getReimbursementLinks(creditTxnId));
  const catList = categoryIds.length ? categoryIds : credit.category_id ? [credit.category_id] : [];
  const placeholders = catList.map(() => "?").join(", ");

  const rows = conn
    .prepare(
      `SELECT t.id, t.txn_date, t.amount_paise,
              COALESCE(p.canonical_name, t.counterparty_raw, t.narration) AS display,
              c.name AS category_name,
              (t.party_id IS NOT NULL AND t.party_id = ?) AS same_party
       FROM transactions t
       LEFT JOIN parties p ON p.id = t.party_id
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.direction = 'debit' AND t.is_transfer = 0
         AND t.txn_date BETWEEN date(?, '-120 days') AND ?
         AND (
           (t.party_id IS NOT NULL AND t.party_id = ?)
           ${catList.length ? `OR t.category_id IN (${placeholders})` : ""}
         )
       ORDER BY same_party DESC, t.txn_date DESC
       LIMIT 20`,
    )
    .all(
      credit.party_id ?? -1,
      credit.txn_date,
      credit.txn_date,
      credit.party_id ?? -1,
      ...catList,
    ) as Array<{
    id: number;
    txn_date: string;
    amount_paise: number;
    display: string;
    category_name: string | null;
  }>;

  // Always include already-linked debits even if they fall outside the window.
  const seen = new Set(rows.map((r) => r.id));
  const missing = [...linked].filter((id) => !seen.has(id));
  if (missing.length) {
    const extra = conn
      .prepare(
        `SELECT t.id, t.txn_date, t.amount_paise,
                COALESCE(p.canonical_name, t.counterparty_raw, t.narration) AS display,
                c.name AS category_name
         FROM transactions t
         LEFT JOIN parties p ON p.id = t.party_id
         LEFT JOIN categories c ON c.id = t.category_id
         WHERE t.id IN (${missing.map(() => "?").join(", ")})`,
      )
      .all(...missing) as typeof rows;
    rows.push(...extra);
  }

  return rows.map((r) => ({ ...r, linked: linked.has(r.id) }));
}
