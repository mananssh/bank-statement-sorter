import "server-only";
import { db } from "@/lib/db/client";
import type { TransactionRow } from "@/lib/db/types";

export interface TxnFilters {
  fyStartYear?: number;
  month?: string; // 'YYYY-MM'
  from?: string;
  to?: string;
  accountId?: number;
  categoryId?: number;
  partyId?: number;
  untagged?: boolean;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface TxnListItem extends TransactionRow {
  account_name: string;
  category_name: string | null;
  category_type: string | null;
  party_name: string | null;
}

function buildWhere(f: TxnFilters): { where: string; params: Record<string, unknown> } {
  const conds: string[] = [];
  const params: Record<string, unknown> = {};
  if (f.fyStartYear !== undefined) {
    conds.push("t.fy_start_year = @fy");
    params.fy = f.fyStartYear;
  }
  if (f.month) {
    conds.push("t.month = @month");
    params.month = f.month;
  }
  if (f.from) {
    conds.push("t.txn_date >= @from");
    params.from = f.from;
  }
  if (f.to) {
    conds.push("t.txn_date <= @to");
    params.to = f.to;
  }
  if (f.accountId !== undefined) {
    conds.push("t.account_id = @account");
    params.account = f.accountId;
  }
  if (f.categoryId !== undefined) {
    conds.push("t.category_id = @category");
    params.category = f.categoryId;
  }
  if (f.partyId !== undefined) {
    conds.push("t.party_id = @party");
    params.party = f.partyId;
  }
  if (f.untagged) {
    conds.push("t.category_id IS NULL");
  }
  if (f.q) {
    conds.push(
      `t.id IN (SELECT rowid FROM txn_fts WHERE txn_fts MATCH @match)`,
    );
    // FTS5 special chars would throw — quote each term.
    params.match = f.q
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => `"${t.replace(/"/g, "")}"`)
      .join(" ");
  }
  return { where: conds.length ? `WHERE ${conds.join(" AND ")}` : "", params };
}

export function listTransactions(f: TxnFilters): { rows: TxnListItem[]; total: number } {
  const { where, params } = buildWhere(f);
  const total = (
    db()
      .prepare(`SELECT COUNT(*) AS n FROM transactions t ${where}`)
      .get(params) as { n: number }
  ).n;
  const rows = db()
    .prepare(
      `SELECT t.*, a.name AS account_name, c.name AS category_name, c.type AS category_type,
              p.canonical_name AS party_name
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN parties p ON p.id = t.party_id
       ${where}
       ORDER BY t.txn_date DESC, t.id DESC
       LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit: f.limit ?? 100, offset: f.offset ?? 0 }) as TxnListItem[];
  return { rows, total };
}

export function untaggedCount(fyStartYear?: number): number {
  const row = db()
    .prepare(
      `SELECT COUNT(*) AS n FROM transactions t
       WHERE t.category_id IS NULL ${fyStartYear !== undefined ? "AND t.fy_start_year = ?" : ""}`,
    )
    .get(...(fyStartYear !== undefined ? [fyStartYear] : [])) as { n: number };
  return row.n;
}

export function updateTxnEnrichment(
  id: number,
  patch: { category_id?: number | null; party_id?: number | null; description?: string | null },
): void {
  const sets: string[] = [];
  const params: Record<string, unknown> = { id };
  if ("category_id" in patch) {
    sets.push("category_id = @category_id", "categorized_by = 'manual'");
    params.category_id = patch.category_id;
  }
  if ("party_id" in patch) {
    sets.push("party_id = @party_id");
    params.party_id = patch.party_id;
  }
  if ("description" in patch) {
    sets.push("description = @description");
    params.description = patch.description;
  }
  if (!sets.length) return;
  db()
    .prepare(`UPDATE transactions SET ${sets.join(", ")} WHERE id = @id`)
    .run(params);
}
