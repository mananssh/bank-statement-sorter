import "server-only";
import { db } from "@/lib/db/client";

/**
 * All dashboard/export rollups. Transfer-linked and transfer-category rows are
 * excluded from income/expense so CC bill payments never double-count.
 * "Range" is any [from, to] ISO date pair (an FY, a month, or custom).
 */

const NON_TRANSFER = `t.is_transfer = 0 AND (c.type IS NULL OR c.type != 'transfer')`;

export interface KpiSummary {
  income_paise: number;
  expense_paise: number;
  investment_paise: number;
  net_flow_paise: number;
  savings_rate: number | null;
  txn_count: number;
  untagged_count: number;
}

export function kpiSummary(from: string, to: string): KpiSummary {
  const row = db()
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN c.type = 'income' AND t.direction = 'credit' THEN t.amount_paise END), 0) AS income,
         COALESCE(SUM(CASE WHEN c.type = 'expense' AND t.direction = 'debit' THEN t.amount_paise END), 0) AS expense,
         COALESCE(SUM(CASE WHEN c.type = 'investment' AND t.direction = 'debit' THEN t.amount_paise END), 0) AS investment,
         COUNT(*) AS txn_count,
         SUM(CASE WHEN t.category_id IS NULL THEN 1 ELSE 0 END) AS untagged
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.txn_date BETWEEN ? AND ? AND ${NON_TRANSFER}`,
    )
    .get(from, to) as {
    income: number;
    expense: number;
    investment: number;
    txn_count: number;
    untagged: number;
  };

  const net = row.income - row.expense - row.investment;
  return {
    income_paise: row.income,
    expense_paise: row.expense,
    investment_paise: row.investment,
    net_flow_paise: net,
    savings_rate: row.income > 0 ? (row.income - row.expense) / row.income : null,
    txn_count: row.txn_count,
    untagged_count: row.untagged,
  };
}

export interface MonthlyRollupRow {
  month: string;
  credits_paise: number;
  debits_paise: number;
  investments_paise: number;
  net_flow_paise: number;
  savings_rate: number | null;
}

export function monthlyRollup(from: string, to: string): MonthlyRollupRow[] {
  const rows = db()
    .prepare(
      `SELECT t.month,
         COALESCE(SUM(CASE WHEN c.type = 'income' AND t.direction = 'credit' THEN t.amount_paise END), 0) AS credits,
         COALESCE(SUM(CASE WHEN c.type = 'expense' AND t.direction = 'debit' THEN t.amount_paise END), 0) AS debits,
         COALESCE(SUM(CASE WHEN c.type = 'investment' AND t.direction = 'debit' THEN t.amount_paise END), 0) AS investments
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.txn_date BETWEEN ? AND ? AND ${NON_TRANSFER}
       GROUP BY t.month ORDER BY t.month`,
    )
    .all(from, to) as Array<{ month: string; credits: number; debits: number; investments: number }>;

  return rows.map((r) => ({
    month: r.month,
    credits_paise: r.credits,
    debits_paise: r.debits,
    investments_paise: r.investments,
    net_flow_paise: r.credits - r.debits - r.investments,
    savings_rate: r.credits > 0 ? (r.credits - r.debits) / r.credits : null,
  }));
}

export interface CategoryRollupRow {
  category_id: number;
  category_name: string;
  category_type: string;
  total_paise: number;
  txn_count: number;
  avg_paise: number;
  largest_paise: number;
  last_date: string;
  pct_of_expense: number | null;
}

export function categoryRollup(from: string, to: string): CategoryRollupRow[] {
  const rows = db()
    .prepare(
      `SELECT c.id AS category_id, c.name AS category_name, c.type AS category_type,
         SUM(t.amount_paise) AS total, COUNT(*) AS n,
         CAST(AVG(t.amount_paise) AS INTEGER) AS avg_p,
         MAX(t.amount_paise) AS largest, MAX(t.txn_date) AS last_date
       FROM transactions t JOIN categories c ON c.id = t.category_id
       WHERE t.txn_date BETWEEN ? AND ? AND t.is_transfer = 0 AND c.type != 'transfer'
       GROUP BY c.id ORDER BY total DESC`,
    )
    .all(from, to) as Array<{
    category_id: number;
    category_name: string;
    category_type: string;
    total: number;
    n: number;
    avg_p: number;
    largest: number;
    last_date: string;
  }>;

  const expenseTotal = rows
    .filter((r) => r.category_type === "expense")
    .reduce((s, r) => s + r.total, 0);

  return rows.map((r) => ({
    category_id: r.category_id,
    category_name: r.category_name,
    category_type: r.category_type,
    total_paise: r.total,
    txn_count: r.n,
    avg_paise: r.avg_p,
    largest_paise: r.largest,
    last_date: r.last_date,
    pct_of_expense:
      r.category_type === "expense" && expenseTotal > 0 ? r.total / expenseTotal : null,
  }));
}

export interface AccountBalance {
  account_id: number;
  account_name: string;
  account_type: string;
  last_balance_paise: number | null;
  last_txn_date: string | null;
  computed_net_paise: number;
}

export function accountBalances(): AccountBalance[] {
  return db()
    .prepare(
      `SELECT a.id AS account_id, a.name AS account_name, a.type AS account_type,
         (SELECT t.balance_paise FROM transactions t WHERE t.account_id = a.id
          ORDER BY t.txn_date DESC, t.id DESC LIMIT 1) AS last_balance_paise,
         (SELECT MAX(t.txn_date) FROM transactions t WHERE t.account_id = a.id) AS last_txn_date,
         COALESCE((SELECT SUM(CASE WHEN t.direction = 'credit' THEN t.amount_paise
                                   ELSE -t.amount_paise END)
          FROM transactions t WHERE t.account_id = a.id), 0) AS computed_net_paise
       FROM accounts a WHERE a.is_active = 1 ORDER BY a.name`,
    )
    .all() as AccountBalance[];
}

export interface RecurringPayee {
  key: string;
  display_name: string;
  occurrences: number;
  avg_amount_paise: number;
  last_date: string;
  median_gap_days: number;
}

/** Payees with >=3 hits at a ~monthly cadence and low amount variance. */
export function recurringPayees(from: string, to: string): RecurringPayee[] {
  const rows = db()
    .prepare(
      `SELECT COALESCE(t.counterparty_vpa, UPPER(t.counterparty_raw)) AS key,
              MAX(COALESCE(t.counterparty_raw, t.counterparty_vpa)) AS display_name,
              COUNT(*) AS n, CAST(AVG(t.amount_paise) AS INTEGER) AS avg_p,
              MAX(t.txn_date) AS last_date,
              GROUP_CONCAT(t.txn_date) AS dates,
              AVG(t.amount_paise * 1.0) AS mean,
              AVG(t.amount_paise * t.amount_paise * 1.0) AS mean_sq
       FROM transactions t
       WHERE t.direction = 'debit' AND t.txn_date BETWEEN ? AND ?
         AND (t.counterparty_vpa IS NOT NULL OR t.counterparty_raw IS NOT NULL)
       GROUP BY key HAVING n >= 3`,
    )
    .all(from, to) as Array<{
    key: string;
    display_name: string;
    n: number;
    avg_p: number;
    last_date: string;
    dates: string;
    mean: number;
    mean_sq: number;
  }>;

  const result: RecurringPayee[] = [];
  for (const r of rows) {
    const variance = r.mean_sq - r.mean * r.mean;
    const cv = r.mean > 0 ? Math.sqrt(Math.max(variance, 0)) / r.mean : 1;
    if (cv > 0.25) continue;

    const dates = r.dates.split(",").sort();
    const gaps: number[] = [];
    for (let i = 1; i < dates.length; i++) {
      gaps.push(
        (Date.parse(dates[i]) - Date.parse(dates[i - 1])) / 86_400_000,
      );
    }
    gaps.sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)];
    if (median < 25 || median > 35) continue;

    result.push({
      key: r.key,
      display_name: r.display_name,
      occurrences: r.n,
      avg_amount_paise: r.avg_p,
      last_date: r.last_date,
      median_gap_days: Math.round(median),
    });
  }
  return result.sort((a, b) => b.avg_amount_paise - a.avg_amount_paise);
}

export interface PendingTransferLink {
  id: number;
  amount_paise: number;
  date_a: string;
  date_b: string;
  account_a: string;
  account_b: string;
  narration_a: string;
  narration_b: string;
}

export function pendingTransferLinks(): PendingTransferLink[] {
  return db()
    .prepare(
      `SELECT l.id, ta.amount_paise, ta.txn_date AS date_a, tb.txn_date AS date_b,
              aa.name AS account_a, ab.name AS account_b,
              ta.narration AS narration_a, tb.narration AS narration_b
       FROM transfer_links l
       JOIN transactions ta ON ta.id = l.txn_a
       JOIN transactions tb ON tb.id = l.txn_b
       JOIN accounts aa ON aa.id = ta.account_id
       JOIN accounts ab ON ab.id = tb.account_id
       WHERE l.confirmed = 0 ORDER BY ta.txn_date DESC LIMIT 20`,
    )
    .all() as PendingTransferLink[];
}
