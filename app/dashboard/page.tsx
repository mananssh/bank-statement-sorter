import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import {
  accountBalances,
  categoryRollup,
  kpiSummary,
  monthlyRollup,
  pendingTransferLinks,
  recurringPayees,
} from "@/lib/repos/reports";
import { listFyYears } from "@/lib/repos/lookups";
import { fyStartMonth } from "@/lib/repos/settings";
import { fyDateRange, fyLabel, fyStartYear as fyOf } from "@/lib/domain/fy";
import { formatPaise } from "@/lib/domain/money";
import { Card, CardTitle, EmptyState, cx } from "@/components/ui";
import { CashflowChart } from "@/components/dashboard/cashflow-chart";
import { CategoryBreakdown, type BreakdownRow } from "@/components/dashboard/category-breakdown";
import { TransferReview } from "@/components/dashboard/transfer-review";

export default function DashboardPage(props: PageProps<"/dashboard">) {
  return (
    <Suspense>
      <DashboardContent searchParamsPromise={props.searchParams} />
    </Suspense>
  );
}

async function DashboardContent({
  searchParamsPromise,
}: {
  searchParamsPromise: PageProps<"/dashboard">["searchParams"];
}) {
  const searchParams = await searchParamsPromise;
  const fyParam = typeof searchParams.fy === "string" ? Number(searchParams.fy) : undefined;
  await connection();

  const startMonth = fyStartMonth();
  const today = new Date().toISOString().slice(0, 10);
  const currentFy = fyOf(today, startMonth);
  const fy = fyParam ?? currentFy;
  const { from, to } = fyDateRange(fy, startMonth);
  const fyYears = listFyYears();
  if (!fyYears.includes(currentFy)) fyYears.unshift(currentFy);

  const kpi = kpiSummary(from, to);
  const monthly = monthlyRollup(from, to);
  const byCategory = categoryRollup(from, to);
  const balances = accountBalances();
  const transfers = pendingTransferLinks();
  const recurring = recurringPayees(from, to);

  const groupRows = (type: "expense" | "income" | "investment"): BreakdownRow[] => {
    const g = byCategory.filter((c) => c.category_type === type);
    const groupTotal = g.reduce((s, c) => s + c.total_paise, 0);
    return g.map((c) => ({
      category_id: c.category_id,
      category_name: c.category_name,
      category_type: c.category_type,
      total_paise: c.total_paise,
      pct: groupTotal > 0 ? c.total_paise / groupTotal : null,
      txn_count: c.txn_count,
      avg_paise: c.avg_paise,
      largest_paise: c.largest_paise,
      last_date: c.last_date,
    }));
  };
  const breakdownGroups = {
    expense: groupRows("expense"),
    income: groupRows("income"),
    investment: groupRows("investment"),
  };
  const breakdownTotals = {
    expense: kpi.expense_paise,
    income: kpi.income_paise,
    investment: kpi.investment_paise,
  };

  const hasData = kpi.txn_count > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Dashboard</h1>
        <div className="flex gap-1.5">
          {fyYears.slice(0, 4).map((y) => (
            <Link
              key={y}
              href={`/dashboard?fy=${y}`}
              className={cx(
                "rounded-lg px-2.5 py-1 text-xs font-medium",
                y === fy
                  ? "bg-accent text-accent-ink"
                  : "border border-edge text-ink-secondary hover:bg-hairline/40",
              )}
            >
              {fyLabel(y, startMonth)}
            </Link>
          ))}
        </div>
      </div>

      {!hasData ? (
        <EmptyState
          title={`No transactions in ${fyLabel(fy, startMonth)}`}
          hint="Import a statement to see your dashboard come alive."
        />
      ) : (
        <>
          {kpi.untagged_count > 0 ? (
            <Link
              href={`/transactions?fy=${fy}&untagged=1`}
              className="block rounded-lg bg-warning-bg px-3 py-2 text-sm font-medium text-warning hover:opacity-90"
            >
              ⚠ {kpi.untagged_count} transaction(s) still untagged — tag them to complete this
              year&apos;s picture →
            </Link>
          ) : null}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Kpi label="Income" value={formatPaise(kpi.income_paise, { compact: true })} tone="text-credit" />
            <Kpi label="Expenses" value={formatPaise(kpi.expense_paise, { compact: true })} tone="text-debit" />
            <Kpi label="Invested" value={formatPaise(kpi.investment_paise, { compact: true })} tone="text-investment" />
            <Kpi
              label="Net flow"
              value={formatPaise(kpi.net_flow_paise, { compact: true })}
              tone={kpi.net_flow_paise >= 0 ? "text-credit" : "text-debit"}
            />
            <Kpi
              label="Savings rate"
              value={kpi.savings_rate !== null ? `${Math.round(kpi.savings_rate * 100)}%` : "—"}
              tone="text-ink"
            />
            <Kpi label="Transactions" value={kpi.txn_count.toLocaleString("en-IN")} tone="text-ink" />
          </div>

          <div className="grid gap-3 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardTitle>Monthly cashflow — {fyLabel(fy, startMonth)}</CardTitle>
              <CashflowChart data={monthly} />
            </Card>
            <Card>
              <CardTitle>Accounts</CardTitle>
              <ul className="space-y-1.5 text-sm">
                {balances.map((a) => (
                  <li key={a.account_id} className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-ink-secondary">{a.account_name}</span>
                    <span className="tnum font-medium">
                      {a.last_balance_paise !== null ? formatPaise(a.last_balance_paise) : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <CategoryBreakdown fy={fy} groups={breakdownGroups} totals={breakdownTotals} />

          {transfers.length > 0 || recurring.length > 0 ? (
            <div className="grid gap-3 xl:grid-cols-2">
              {transfers.length > 0 ? (
                <Card>
                  <CardTitle>Possible transfers ({transfers.length})</CardTitle>
                  <TransferReview links={transfers} />
                </Card>
              ) : null}

              {recurring.length > 0 ? (
                <Card>
                  <CardTitle>Recurring payments</CardTitle>
                  <ul className="space-y-1.5 text-sm">
                    {recurring.slice(0, 8).map((r) => (
                      <li key={r.key} className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-ink-secondary" title={r.display_name}>
                          {r.display_name}
                          <span className="ml-1 text-xs text-ink-muted">×{r.occurrences}</span>
                        </span>
                        <span className="tnum">{formatPaise(r.avg_amount_paise)}/mo</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-xl border border-edge bg-surface px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">{label}</p>
      <p className={cx("text-lg font-semibold tnum", tone)}>{value}</p>
    </div>
  );
}
