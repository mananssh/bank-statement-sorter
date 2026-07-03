import "server-only";
import type { Database } from "better-sqlite3";

/**
 * Cross-account transfer detection. A CC bill payment shows up as a debit in
 * the bank statement AND a credit in the card statement — linking the pair
 * keeps it out of income/expense totals. Candidates: opposite directions,
 * identical paise, different accounts, dates within ±4 days. Links start
 * unconfirmed; the dashboard offers one-click confirm/reject.
 */
export function detectTransfers(db: Database, dateFrom: string, dateTo: string): number {
  const candidates = db
    .prepare(
      `SELECT a.id AS txn_a, b.id AS txn_b,
              CASE WHEN ca.type = 'transfer' OR cb.type = 'transfer'
                   THEN 'cc_bill_pattern' ELSE 'amount_date' END AS method
       FROM transactions a
       JOIN transactions b
         ON b.account_id != a.account_id
        AND b.direction != a.direction
        AND b.amount_paise = a.amount_paise
        AND b.txn_date BETWEEN date(a.txn_date, '-4 days') AND date(a.txn_date, '+4 days')
        AND a.id < b.id
       LEFT JOIN categories ca ON ca.id = a.category_id
       LEFT JOIN categories cb ON cb.id = b.category_id
       WHERE a.txn_date BETWEEN ? AND ?
         AND a.is_transfer = 0 AND b.is_transfer = 0
         AND NOT EXISTS (
           SELECT 1 FROM transfer_links l
           WHERE (l.txn_a = a.id AND l.txn_b = b.id) OR (l.txn_a = b.id AND l.txn_b = a.id)
         )`,
    )
    .all(dateFrom, dateTo) as Array<{ txn_a: number; txn_b: number; method: string }>;

  const insert = db.prepare(
    `INSERT INTO transfer_links (txn_a, txn_b, method) VALUES (?, ?, ?)
     ON CONFLICT(txn_a, txn_b) DO NOTHING`,
  );
  // Avoid chaining one txn into multiple links in a single pass.
  const used = new Set<number>();
  let created = 0;
  for (const c of candidates) {
    if (used.has(c.txn_a) || used.has(c.txn_b)) continue;
    const res = insert.run(c.txn_a, c.txn_b, c.method);
    if (res.changes > 0) {
      used.add(c.txn_a);
      used.add(c.txn_b);
      created++;
    }
  }
  return created;
}

export function confirmTransferLink(db: Database, linkId: number): void {
  const link = db
    .prepare(`SELECT txn_a, txn_b FROM transfer_links WHERE id = ?`)
    .get(linkId) as { txn_a: number; txn_b: number } | undefined;
  if (!link) return;
  const tx = db.transaction(() => {
    db.prepare(`UPDATE transfer_links SET confirmed = 1 WHERE id = ?`).run(linkId);
    db.prepare(`UPDATE transactions SET is_transfer = 1 WHERE id IN (?, ?)`).run(
      link.txn_a,
      link.txn_b,
    );
  });
  tx();
}

export function rejectTransferLink(db: Database, linkId: number): void {
  db.prepare(`DELETE FROM transfer_links WHERE id = ?`).run(linkId);
}
