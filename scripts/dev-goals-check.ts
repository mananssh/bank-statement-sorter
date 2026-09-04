/**
 * Dev-only check of goal attribution. Makes no network calls, and writes goal
 * rows — so point DATA_DIR at a throwaway copy of a database, never the live
 * one. Run with the react-server condition so "server-only" modules load:
 *
 *   DATA_DIR=<tmp> NODE_OPTIONS=--conditions=react-server npx tsx scripts/dev-goals-check.ts
 *
 * Asserts the invariants that make the units model trustworthy:
 *  1. Units are conserved  — goal slices + unassigned == the fund's SIP units.
 *  2. Rupees are conserved — goal cost + unassigned cost == total SIP cost,
 *                            to the paise, with no rounding hole.
 *  3. Partial shares leave a real unassigned remainder rather than rescaling.
 *  4. Staggered starts     — a later goal claims strictly less than an earlier
 *                            one on the same share.
 *  5. Equal shares over the same window earn an identical per-rupee return,
 *     which is the fairness property the whole design rests on.
 */
import { db } from "@/lib/db/client";
import { goalAttribution } from "@/lib/repos/goals";

const conn = db();
const EPS = 0.0001;
let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${label}${ok || !detail ? "" : `  — ${detail}`}`);
  if (!ok) failures++;
}

const existing = conn.prepare(`SELECT COUNT(*) n FROM goals`).get() as { n: number };
if (existing.n > 0) {
  console.error(
    `refusing to run: ${existing.n} goal row(s) already present. Use DATA_DIR with a scratch copy.`,
  );
  process.exit(1);
}

// Reference totals read straight from the transactions, SIP-active funds only.
const totals = conn
  .prepare(
    `SELECT t.fund_id,
            SUM(CASE WHEN t.txn_type IN ('sip','lumpsum') THEN COALESCE(t.units,0)
                     WHEN t.txn_type = 'sell' THEN -COALESCE(t.units,0) ELSE 0 END) units,
            SUM(CASE WHEN t.txn_type IN ('sip','lumpsum') THEN t.amount_paise
                     WHEN t.txn_type = 'sell' THEN -t.amount_paise ELSE 0 END) cost
     FROM investment_txns t JOIN funds f ON f.id = t.fund_id
     WHERE f.is_sip_active = 1 GROUP BY t.fund_id`,
  )
  .all() as Array<{ fund_id: number; units: number; cost: number }>;
const span = conn
  .prepare(
    `SELECT MIN(t.txn_date) first, MAX(t.txn_date) last FROM investment_txns t
     JOIN funds f ON f.id = t.fund_id WHERE f.is_sip_active = 1`,
  )
  .get() as { first: string | null; last: string };

if (!span.first) {
  console.error("no SIP-active purchases in this database — nothing to attribute.");
  process.exit(1);
}
const totalCost = totals.reduce((s, t) => s + t.cost, 0);
console.log(
  `SIP-active funds with history: ${totals.length}, purchases ${span.first} → ${span.last}, ` +
    `total ${(totalCost / 100).toFixed(2)}\n`,
);

const insert = conn.prepare(`INSERT INTO goals (name, start_date, sip_share_pct) VALUES (?, ?, ?)`);
const reset = () => conn.prepare(`DELETE FROM goals`).run();

/** Runs the real attribution and asserts the two conservation laws. */
function conservation(label: string) {
  const a = goalAttribution();
  const buckets = [...a.goals.filter((g) => g.is_archived === 0), a.unassigned];

  let detail = "";
  for (const t of totals) {
    const got = buckets.reduce(
      (sum, b) => sum + (b.slices.find((s) => s.fund_id === t.fund_id)?.units ?? 0),
      0,
    );
    if (Math.abs(got - t.units) > EPS) detail = `fund ${t.fund_id}: ${got} vs ${t.units}`;
  }
  check(`${label}: units conserved per fund`, detail === "", detail);

  const gotCost = buckets.reduce((s, b) => s + b.cost_paise, 0);
  check(`${label}: rupees conserved to the paise`, gotCost === totalCost, `${gotCost} vs ${totalCost}`);
  return a;
}

// --- 1. no goals: everything falls through to unassigned -----------------
reset();
{
  const a = conservation("no goals");
  check("no goals: all cost unassigned", a.goals.length === 0 && a.unassigned.cost_paise === totalCost);
}

// --- 2. one goal at 100% from the first purchase claims everything -------
reset();
insert.run("all", span.first, 100);
{
  const a = conservation("one goal at 100%");
  check(
    "100% goal claims everything, unassigned empty",
    a.goals[0].cost_paise === totalCost && a.unassigned.cost_paise === 0,
    `goal ${a.goals[0].cost_paise}, unassigned ${a.unassigned.cost_paise}`,
  );
}

// --- 3. a partial share leaves a real remainder --------------------------
reset();
insert.run("partial", span.first, 40);
{
  const a = conservation("one goal at 40%");
  const g = a.goals[0];
  check(
    "40% goal claims 40% of cost",
    Math.abs(g.cost_paise / totalCost - 0.4) < 0.0001,
    `${((g.cost_paise / totalCost) * 100).toFixed(4)}%`,
  );
  check("remainder shown as unassigned, not rescaled", a.unassigned.cost_paise > 0);
}

// --- 4. staggered starts: the later goal owns strictly less --------------
reset();
insert.run("early", span.first, 50);
insert.run("late", span.last, 50);
{
  const a = conservation("staggered starts");
  const early = a.goals.find((g) => g.name === "early")!;
  const late = a.goals.find((g) => g.name === "late")!;
  check(
    "later goal claims strictly less on an equal share",
    late.cost_paise < early.cost_paise,
    `early ${early.cost_paise} vs late ${late.cost_paise}`,
  );
  check("later goal still holds the purchases from its start date", late.cost_paise > 0);
  console.log(
    `    early owns ${((early.cost_paise / (early.cost_paise + late.cost_paise)) * 100).toFixed(1)}%` +
      ` of the two goals' units despite an equal 50% share`,
  );
}

// --- 5. equal shares over one window => identical returns ---------------
reset();
insert.run("twin-a", span.first, 30);
insert.run("twin-b", span.first, 30);
{
  const a = conservation("twin goals");
  const x = a.goals.find((g) => g.name === "twin-a")!;
  const y = a.goals.find((g) => g.name === "twin-b")!;
  check(
    "identical window + share => identical invested",
    Math.abs(x.cost_paise - y.cost_paise) <= 1,
    `${x.cost_paise} vs ${y.cost_paise}`,
  );
  const rx = x.value_paise !== null ? x.value_paise / x.cost_paise : null;
  const ry = y.value_paise !== null ? y.value_paise / y.cost_paise : null;
  check(
    "identical window + share => identical per-rupee return",
    rx !== null && ry !== null && Math.abs(rx - ry) < 1e-6,
    `${rx} vs ${ry}`,
  );
  console.log(
    `    each twin: invested ${(x.cost_paise / 100).toFixed(2)}, ` +
      `value ${x.value_paise !== null ? (x.value_paise / 100).toFixed(2) : "—"}, ` +
      `xirr ${x.xirr_pct !== null ? x.xirr_pct.toFixed(2) + "%" : "—"}, ` +
      `${x.slices.length} fund slices`,
  );
  check("unassigned holds the other 40%", a.unassigned.cost_paise > 0);
}

// --- 6. over-allocation is reported, not silently absorbed --------------
reset();
insert.run("greedy-a", span.first, 70);
insert.run("greedy-b", span.first, 70);
check("shares over 100% are flagged", goalAttribution().over_allocated);

reset();
console.log(`\n${failures} failure(s)`);
process.exit(failures ? 1 : 0);
