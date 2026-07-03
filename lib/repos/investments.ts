import "server-only";
import { db } from "@/lib/db/client";
import { getSetting } from "@/lib/repos/settings";
import type { FixedDepositRow, GoalRow, HoldingRow } from "@/lib/db/types";

export function listHoldings(): Array<HoldingRow & { market_value_paise: number | null }> {
  const rows = db().prepare(`SELECT * FROM holdings ORDER BY name`).all() as HoldingRow[];
  return rows.map((h) => ({
    ...h,
    market_value_paise: h.last_nav !== null ? Math.round(h.units * h.last_nav * 100) : null,
  }));
}

export interface SipMonthStatus {
  budget_paise: number | null;
  invested_this_month_paise: number;
  month: string;
}

export function sipMonthStatus(): SipMonthStatus {
  const month = new Date().toISOString().slice(0, 7);
  const row = db()
    .prepare(
      `SELECT COALESCE(SUM(amount_paise), 0) AS n FROM investment_txns
       WHERE txn_type IN ('sip','lumpsum') AND substr(txn_date, 1, 7) = ?`,
    )
    .get(month) as { n: number };
  return {
    budget_paise: getSetting<number | null>("sip_budget_paise", null),
    invested_this_month_paise: row.n,
    month,
  };
}

export interface ElssStatus {
  ceiling_paise: number;
  invested_fy_paise: number;
  months_left: number;
}

export function elssStatus(fyStartYear: number, fyStartMonth: number): ElssStatus {
  const row = db()
    .prepare(
      `SELECT COALESCE(SUM(t.amount_paise), 0) AS n
       FROM investment_txns t JOIN funds f ON f.id = t.fund_id
       WHERE f.is_elss = 1 AND t.txn_type IN ('sip','lumpsum') AND t.fy_start_year = ?`,
    )
    .get(fyStartYear) as { n: number };
  const now = new Date();
  const fyEnd = new Date(Date.UTC(fyStartMonth === 1 ? fyStartYear : fyStartYear + 1, fyStartMonth - 1, 1));
  const monthsLeft = Math.max(
    0,
    (fyEnd.getUTCFullYear() - now.getUTCFullYear()) * 12 + (fyEnd.getUTCMonth() - now.getUTCMonth()),
  );
  return {
    ceiling_paise: getSetting<number>("ceiling_80c_paise", 150000 * 100),
    invested_fy_paise: row.n,
    months_left: monthsLeft,
  };
}

export function listGoals(): Array<GoalRow & { value_paise: number | null }> {
  const goals = db().prepare(`SELECT * FROM goals ORDER BY allocation_pct DESC`).all() as GoalRow[];
  const holdings = listHoldings();
  const portfolio = holdings.reduce(
    (sum, h) => sum + (h.market_value_paise ?? h.cost_basis_paise),
    0,
  );
  return goals.map((g) => ({
    ...g,
    value_paise: portfolio > 0 ? Math.round((portfolio * g.allocation_pct) / 100) : null,
  }));
}

export function listFixedDeposits(): FixedDepositRow[] {
  return db()
    .prepare(`SELECT * FROM fixed_deposits ORDER BY maturity_date`)
    .all() as FixedDepositRow[];
}

export interface AllocationSlice {
  asset_class: string;
  value_paise: number;
}

export function allocationByClass(): AllocationSlice[] {
  const holdings = listHoldings();
  const byClass = new Map<string, number>();
  for (const h of holdings) {
    const v = h.market_value_paise ?? h.cost_basis_paise;
    byClass.set(h.asset_class, (byClass.get(h.asset_class) ?? 0) + v);
  }
  return [...byClass.entries()]
    .map(([asset_class, value_paise]) => ({ asset_class, value_paise }))
    .sort((a, b) => b.value_paise - a.value_paise);
}
