import { db } from "@/lib/db/client";
import { xirr, type CashFlow } from "@/lib/domain/xirr";
import type { GoalRow } from "@/lib/db/types";

/**
 * Goal attribution: carve the units of every SIP purchase into per-goal slices.
 *
 * A goal claims `sip_share_pct` of the UNITS bought in each SIP-active
 * instrument on or after its `start_date`. Units are the invariant — once
 * recorded they never change — so a goal's slice is a real sub-portfolio whose
 * invested amount and current value both derive from it, and whose slices
 * always sum back to the instrument's true total units.
 *
 * Nothing is stored per transaction: the whole ledger is DERIVED from
 * (purchases x goal start dates) on every read. Correcting a start date
 * therefore retroactively fixes every number, with nothing to keep in sync.
 *
 * Consequences worth knowing:
 *  - Shares stagger over time. A purchase is split only among goals active on
 *    its date, so an older goal keeps a larger share of total units forever
 *    even though every new purchase splits by the same percentages. No single
 *    stored percentage can express that, which is why start_date lives here.
 *  - Goals cover `is_sip_active` instruments only. Turning SIP off for an
 *    instrument removes its history from goals; `excludedFunds` reports the
 *    ones with purchase history that are being skipped.
 *  - Instruments with no purchase history (e-CAS observed positions) have units
 *    but no dates or NAVs, so they cannot be attributed and are left out.
 *  - Goal shares need not total 100%. The remainder is a real `unassigned`
 *    bucket, never rescaled away.
 */

export interface GoalFundSlice {
  fund_id: number;
  fund_name: string;
  units: number;
  cost_paise: number;
  value_paise: number | null;
}

interface Bucket {
  cost_paise: number;
  /** fund_id -> units + cost, so each slice can be valued at its own NAV. */
  slices: Map<number, { units: number; cost_paise: number }>;
  flows: CashFlow[];
}

export interface GoalView extends GoalRow {
  cost_paise: number;
  value_paise: number | null;
  pnl_paise: number | null;
  xirr_pct: number | null;
  slices: GoalFundSlice[];
}

export interface UnassignedView {
  cost_paise: number;
  value_paise: number | null;
  pnl_paise: number | null;
  slices: GoalFundSlice[];
}

export interface GoalAttribution {
  goals: GoalView[];
  unassigned: UnassignedView;
  /** SIP purchases considered (buys on SIP-active instruments). */
  purchases: number;
  /** Purchases that predate every goal, so nothing could claim them. */
  purchases_before_any_goal: number;
  /** Has purchase history but is not SIP-active, so it sits outside goals. */
  excluded_funds: Array<{ fund_id: number; name: string; txns: number }>;
  /** True when non-archived shares total over 100% — over-claimed units. */
  over_allocated: boolean;
}

interface TxnRow {
  fund_id: number;
  txn_date: string;
  txn_type: string;
  amount_paise: number;
  units: number | null;
}

function emptyBucket(): Bucket {
  return { cost_paise: 0, slices: new Map(), flows: [] };
}

function addTo(b: Bucket, fundId: number, units: number, costPaise: number) {
  const slice = b.slices.get(fundId) ?? { units: 0, cost_paise: 0 };
  slice.units += units;
  slice.cost_paise += costPaise;
  b.slices.set(fundId, slice);
  b.cost_paise += costPaise;
}

export function listGoalRows(): GoalRow[] {
  return db()
    .prepare(`SELECT * FROM goals ORDER BY start_date, name`)
    .all() as GoalRow[];
}

export function goalAttribution(): GoalAttribution {
  const conn = db();

  const funds = conn
    .prepare(
      `SELECT f.id, f.name, f.is_sip_active,
              (SELECT n.nav FROM fund_navs n WHERE n.fund_id = f.id
               ORDER BY n.nav_date DESC LIMIT 1) AS last_nav
       FROM funds f`,
    )
    .all() as Array<{ id: number; name: string; is_sip_active: number; last_nav: number | null }>;
  const fundById = new Map(funds.map((f) => [f.id, f]));
  const sipFundIds = new Set(funds.filter((f) => f.is_sip_active === 1).map((f) => f.id));

  const allTxns = conn
    .prepare(
      `SELECT fund_id, txn_date, txn_type, amount_paise, units FROM investment_txns
       ORDER BY txn_date, id`,
    )
    .all() as TxnRow[];

  const excludedCounts = new Map<number, number>();
  for (const t of allTxns) {
    if (!sipFundIds.has(t.fund_id)) {
      excludedCounts.set(t.fund_id, (excludedCounts.get(t.fund_id) ?? 0) + 1);
    }
  }

  const goals = listGoalRows().filter((g) => g.is_archived === 0);
  const buckets = new Map<number, Bucket>(goals.map((g) => [g.id, emptyBucket()]));
  const unassigned = emptyBucket();

  let purchases = 0;
  let beforeAnyGoal = 0;

  for (const t of allTxns) {
    if (!sipFundIds.has(t.fund_id)) continue;

    // Dividends move neither units nor cost basis, matching the holdings view.
    if (t.txn_type === "dividend") continue;

    if (t.txn_type === "sell") {
      // A sale leaves the pool, so it must come out of whoever actually holds
      // the units — pro-rata on current holdings, not on share percentages. A
      // goal that only just started has few units and gives up few.
      const held: Array<[Bucket, number]> = [];
      let heldUnits = 0;
      for (const b of [...buckets.values(), unassigned]) {
        const u = b.slices.get(t.fund_id)?.units ?? 0;
        if (u > 0) {
          held.push([b, u]);
          heldUnits += u;
        }
      }
      const soldUnits = t.units ?? 0;
      if (heldUnits <= 0) {
        addTo(unassigned, t.fund_id, -soldUnits, -t.amount_paise);
        unassigned.flows.push({ date: t.txn_date, amount: t.amount_paise });
        continue;
      }
      let assignedPaise = 0;
      let assignedUnits = 0;
      for (let i = 0; i < held.length; i++) {
        const [b, u] = held[i];
        const share = u / heldUnits;
        // Last holder absorbs the residual so units and cost stay conserved.
        const isLast = i === held.length - 1;
        const paise = isLast
          ? t.amount_paise - assignedPaise
          : Math.round(t.amount_paise * share);
        const units = isLast ? soldUnits - assignedUnits : soldUnits * share;
        assignedPaise += paise;
        assignedUnits += units;
        addTo(b, t.fund_id, -units, -paise);
        b.flows.push({ date: t.txn_date, amount: paise });
      }
      continue;
    }

    // Buy: sip or lumpsum.
    purchases++;
    const units = t.units ?? 0;
    const active = goals.filter((g) => g.start_date <= t.txn_date && g.sip_share_pct > 0);
    if (active.length === 0) beforeAnyGoal++;

    let claimedPaise = 0;
    let claimedUnits = 0;
    for (const g of active) {
      const share = g.sip_share_pct / 100;
      const paise = Math.round(t.amount_paise * share);
      const u = units * share;
      claimedPaise += paise;
      claimedUnits += u;
      const b = buckets.get(g.id)!;
      addTo(b, t.fund_id, u, paise);
      b.flows.push({ date: t.txn_date, amount: -paise });
    }
    // The remainder is the unassigned bucket, computed by subtraction so that
    // rupees and units are conserved exactly rather than left to rounding.
    const restPaise = t.amount_paise - claimedPaise;
    const restUnits = units - claimedUnits;
    addTo(unassigned, t.fund_id, restUnits, restPaise);
    if (restPaise !== 0) unassigned.flows.push({ date: t.txn_date, amount: -restPaise });
  }

  const today = new Date().toISOString().slice(0, 10);

  function sliceViews(b: Bucket): GoalFundSlice[] {
    return [...b.slices.entries()]
      .filter(([, s]) => Math.abs(s.units) > 0.0001 || s.cost_paise !== 0)
      .map(([fundId, s]) => {
        const fund = fundById.get(fundId);
        return {
          fund_id: fundId,
          fund_name: fund?.name ?? `#${fundId}`,
          units: s.units,
          cost_paise: s.cost_paise,
          value_paise:
            fund?.last_nav != null ? Math.round(s.units * fund.last_nav * 100) : null,
        };
      })
      .sort((a, b) => (b.value_paise ?? 0) - (a.value_paise ?? 0));
  }

  /** Null when any held slice lacks a NAV — a partial total would mislead. */
  function bucketValue(slices: GoalFundSlice[]): number | null {
    if (slices.length === 0) return 0;
    if (slices.some((s) => s.value_paise === null)) return null;
    return slices.reduce((sum, s) => sum + (s.value_paise ?? 0), 0);
  }

  const goalViews: GoalView[] = goals.map((g) => {
    const b = buckets.get(g.id)!;
    const slices = sliceViews(b);
    const value = bucketValue(slices);
    const rate =
      value !== null && b.flows.length > 0
        ? xirr([...b.flows, { date: today, amount: value }])
        : null;
    return {
      ...g,
      cost_paise: b.cost_paise,
      value_paise: value,
      pnl_paise: value !== null ? value - b.cost_paise : null,
      xirr_pct: rate !== null ? rate * 100 : null,
      slices,
    };
  });

  const archived = listGoalRows().filter((g) => g.is_archived === 1);
  const unSlices = sliceViews(unassigned);
  const unValue = bucketValue(unSlices);

  return {
    goals: [...goalViews, ...archived.map(archivedView)],
    unassigned: {
      cost_paise: unassigned.cost_paise,
      value_paise: unValue,
      pnl_paise: unValue !== null ? unValue - unassigned.cost_paise : null,
      slices: unSlices,
    },
    purchases,
    purchases_before_any_goal: beforeAnyGoal,
    excluded_funds: [...excludedCounts.entries()].map(([fundId, txns]) => ({
      fund_id: fundId,
      name: fundById.get(fundId)?.name ?? `#${fundId}`,
      txns,
    })),
    over_allocated: goals.reduce((s, g) => s + g.sip_share_pct, 0) > 100.01,
  };
}

/** Archived goals claim nothing, so they render as an empty shell. */
function archivedView(g: GoalRow): GoalView {
  return {
    ...g,
    cost_paise: 0,
    value_paise: null,
    pnl_paise: null,
    xirr_pct: null,
    slices: [],
  };
}
