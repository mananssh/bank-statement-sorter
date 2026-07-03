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
import { seriesColorFor } from "@/lib/ui/colors";
import { Card, CardTitle, EmptyState, Table, Th, Td, cx } from "@/components/ui";
import { CashflowChart } from "@/components/dashboard/cashflow-chart";
import { CategoryDonut } from "@/components/dashboard/category-donut";
import { TransferReview } from "@/components/dashboard/transfer-review";

export default async function DashboardPage(props: PageProps<"/dashboard">) {
  const searchParams = await props.searchParams;
  const fyParam = typeof searchParams.fy === "string" ? Number(searchParams.fy) : undefined;
  return (
    <Suspense>
      <DashboardContent fyParam={fyParam} />
    </Suspense>
  );
}

async function DashboardContent({ fyParam }: { fyParam?: number }) {
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
  const expenses = byCategory.filter((c) => c.category_type === "expense");
  const balances = accountBalances();
  const transfers = pendingTransferLinks();
  const recurring = recurringPayees(from, to);

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
              <CardTitle>Where it went</CardTitle>
              {expenses.length ? (
                <CategoryDonut
                  slices={expenses.map((e) => ({
                    category_id: e.category_id,
                    name: e.category_name,
                    value_paise: e.total_paise,
                  }))}
                  total_paise={kpi.expense_paise}
                />
              ) : (
                <p className="text-sm text-ink-muted">No categorized expenses yet.</p>
              )}
            </Card>
          </div>

          <div className="grid gap-3 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardTitle>Category breakdown</CardTitle>
              <Table className="border-0">
                <thead>
                  <tr>
                    <Th>Category</Th>
                    <Th className="text-right">Total</Th>
                    <Th className="text-right">% of expense</Th>
                    <Th className="text-right">Txns</Th>
                    <Th className="text-right">Avg</Th>
                    <Th className="text-right">Largest</Th>
                    <Th>Last</Th>
                  </tr>
                </thead>
                <tbody>
                  {byCategory.map((c) => (
                    <tr key={c.category_id}>
                      <Td>
                        <span className="flex items-center gap-2">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-sm"
                            style={{
                              background:
                                c.category_type === "expense"
                                  ? seriesColorFor(c.category_id)
                                  : "var(--ink-muted)",
                            }}
                          />
                          <Link
                            href={`/transactions?fy=${fy}&category=${c.category_id}`}
                            className="font-medium hover:text-accent"
                          >
                            {c.category_name}
                          </Link>
                        </span>
                      </Td>
                      <Td className="text-right tnum font-medium">{formatPaise(c.total_paise)}</Td>
                      <Td className="text-right tnum text-ink-secondary">
                        {c.pct_of_expense !== null ? `${(c.pct_of_expense * 100).toFixed(1)}%` : "—"}
                      </Td>
                      <Td className="text-right tnum">{c.txn_count}</Td>
                      <Td className="text-right tnum text-ink-secondary">{formatPaise(c.avg_paise)}</Td>
                      <Td className="text-right tnum text-ink-secondary">{formatPaise(c.largest_paise)}</Td>
                      <Td className="whitespace-nowrap text-xs text-ink-muted">{c.last_date}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>

            <div className="space-y-3">
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
          </div>
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
