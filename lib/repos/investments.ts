import "server-only";
import { db } from "@/lib/db/client";
import { getSetting } from "@/lib/repos/settings";
import { xirr, type CashFlow } from "@/lib/domain/xirr";
import {
  BALANCE_KINDS,
  type AllocationTargetRow,
  type FixedDepositRow,
  type FundRow,
  type GoalRow,
  type HoldingRow,
} from "@/lib/db/types";

/**
 * Value resolution per instrument: an explicit manual valuation wins (the only
 * source for balance-based PPF/EPF/NPS), else units × latest NAV, else null
 * (UI falls back to cost). XIRR treats buys as outflows, sells/dividends as
 * inflows, and current value as the terminal inflow.
 */

export interface HoldingView extends HoldingRow {
  market_value_paise: number | null;
  pnl_paise: number | null;
  xirr_pct: number | null;
  is_balance_kind: boolean;
}

function resolveValue(h: HoldingRow): number | null {
  if (h.last_valuation_paise !== null) return h.last_valuation_paise;
  if (h.last_nav !== null) return Math.round(h.units * h.last_nav * 100);
  return null;
}

type FlowRow = { fund_id: number; txn_date: string; txn_type: string; amount_paise: number };

function flowsByFund(): Map<number, CashFlow[]> {
  const rows = db()
    .prepare(
      `SELECT fund_id, txn_date, txn_type, amount_paise FROM investment_txns ORDER BY txn_date`,
    )
    .all() as FlowRow[];
  const map = new Map<number, CashFlow[]>();
  for (const r of rows) {
    const sign = r.txn_type === "sip" || r.txn_type === "lumpsum" ? -1 : 1;
    (map.get(r.fund_id) ?? map.set(r.fund_id, []).get(r.fund_id)!).push({
      date: r.txn_date,
      amount: sign * r.amount_paise,
    });
  }
  return map;
}

export function listHoldings(): HoldingView[] {
  const rows = db().prepare(`SELECT * FROM holdings ORDER BY name`).all() as HoldingRow[];
  const flows = flowsByFund();
  const today = new Date().toISOString().slice(0, 10);

  return rows.map((h) => {
    const value = resolveValue(h);
    const fundFlows = flows.get(h.fund_id) ?? [];
    const rate =
      value !== null && fundFlows.length > 0
        ? xirr([...fundFlows, { date: today, amount: value }])
        : null;
    return {
      ...h,
      market_value_paise: value,
      pnl_paise: value !== null ? value - h.cost_basis_paise : null,
      xirr_pct: rate !== null ? rate * 100 : null,
      is_balance_kind: BALANCE_KINDS.includes(h.instrument_kind),
    };
  });
}

export interface PortfolioSummary {
  invested_paise: number;
  value_paise: number;
  pnl_paise: number;
  xirr_pct: number | null;
  holding_count: number;
}

export function portfolioSummary(holdings: HoldingView[]): PortfolioSummary {
  const invested = holdings.reduce((s, h) => s + h.cost_basis_paise, 0);
  const value = holdings.reduce((s, h) => s + (h.market_value_paise ?? h.cost_basis_paise), 0);

  const flows = flowsByFund();
  const all: CashFlow[] = [];
  const today = new Date().toISOString().slice(0, 10);
  for (const h of holdings) for (const f of flows.get(h.fund_id) ?? []) all.push(f);
  all.sort((a, b) => a.date.localeCompare(b.date));
  if (value > 0) all.push({ date: today, amount: value });
  const rate = xirr(all);

  return {
    invested_paise: invested,
    value_paise: value,
    pnl_paise: value - invested,
    xirr_pct: rate !== null ? rate * 100 : null,
    holding_count: holdings.length,
  };
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

export interface SipTrackerRow {
  fund_id: number;
  name: string;
  sip_amount_paise: number | null;
  invested_this_month_paise: number;
}

/** Active-SIP instruments: what was expected vs what actually went in this month. */
export function sipTracker(): SipTrackerRow[] {
  const month = new Date().toISOString().slice(0, 7);
  return db()
    .prepare(
      `SELECT f.id AS fund_id, f.name, f.sip_amount_paise,
              COALESCE((SELECT SUM(t.amount_paise) FROM investment_txns t
                        WHERE t.fund_id = f.id AND t.txn_type IN ('sip','lumpsum')
                          AND substr(t.txn_date, 1, 7) = ?), 0) AS invested_this_month_paise
       FROM funds f WHERE f.is_sip_active = 1 ORDER BY f.name`,
    )
    .all(month) as SipTrackerRow[];
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
       WHERE (f.is_elss = 1 OR f.asset_class = 'elss')
         AND t.txn_type IN ('sip','lumpsum') AND t.fy_start_year = ?`,
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
  actual_pct: number;
  target_pct: number | null;
}

export function allocationByClass(holdings: HoldingView[]): AllocationSlice[] {
  const targets = listAllocationTargets().filter((t) => t.sub_category === "");
  const byClass = new Map<string, number>();
  for (const h of holdings) {
    const v = h.market_value_paise ?? h.cost_basis_paise;
    byClass.set(h.asset_class, (byClass.get(h.asset_class) ?? 0) + v);
  }
  const total = [...byClass.values()].reduce((s, v) => s + v, 0);
  const classes = new Set([...byClass.keys(), ...targets.map((t) => t.asset_class)]);
  return [...classes]
    .map((asset_class) => {
      const value = byClass.get(asset_class) ?? 0;
      return {
        asset_class,
        value_paise: value,
        actual_pct: total > 0 ? (value / total) * 100 : 0,
        target_pct: targets.find((t) => t.asset_class === asset_class)?.target_pct ?? null,
      };
    })
    .sort((a, b) => b.value_paise - a.value_paise);
}

export function listInstruments(): FundRow[] {
  return db().prepare(`SELECT * FROM funds ORDER BY name`).all() as FundRow[];
}

/** FYs (start years) that have investment transactions, newest first. */
export function listInvestmentFys(): number[] {
  return (
    db()
      .prepare(
        `SELECT DISTINCT fy_start_year AS y FROM investment_txns ORDER BY fy_start_year DESC`,
      )
      .all() as Array<{ y: number }>
  ).map((r) => r.y);
}

export function listAllocationTargets(): AllocationTargetRow[] {
  return db()
    .prepare(`SELECT * FROM allocation_targets ORDER BY sub_category, target_pct DESC`)
    .all() as AllocationTargetRow[];
}
