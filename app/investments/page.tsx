import { Suspense } from "react";
import { connection } from "next/server";
import {
  allocationByClass,
  elssStatus,
  listFixedDeposits,
  listGoals,
  listHoldings,
  sipMonthStatus,
} from "@/lib/repos/investments";
import { fyStartMonth } from "@/lib/repos/settings";
import { fyStartYear } from "@/lib/domain/fy";
import { formatPaise } from "@/lib/domain/money";
import { Badge, Card, CardTitle, EmptyState, Table, Th, Td, cx } from "@/components/ui";
import {
  FdForm,
  FdStatusButton,
  NavEditor,
  SipBudgetForm,
} from "@/components/investments/investments-client";

export default function InvestmentsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Investments</h1>
        <p className="text-sm text-ink-secondary">
          Holdings, SIP progress, tax planning, and fixed deposits. Import your MF order book via
          Import, or bootstrap an investments workbook in Settings.
        </p>
      </div>
      <Suspense>
        <Content />
      </Suspense>
    </div>
  );
}

async function Content() {
  await connection();
  const holdings = listHoldings();
  const goals = listGoals();
  const fds = listFixedDeposits();
  const sip = sipMonthStatus();
  const startMonth = fyStartMonth();
  const elss = elssStatus(fyStartYear(new Date().toISOString().slice(0, 10), startMonth), startMonth);
  const allocation = allocationByClass();
  const portfolio = holdings.reduce((s, h) => s + (h.market_value_paise ?? h.cost_basis_paise), 0);

  return (
    <>
      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardTitle>This month&apos;s investing</CardTitle>
          <p className="text-lg font-semibold tnum">
            {formatPaise(sip.invested_this_month_paise)}
            {sip.budget_paise ? (
              <span className="text-sm font-normal text-ink-muted">
                {" "}
                / {formatPaise(sip.budget_paise)} budget
              </span>
            ) : null}
          </p>
          {sip.budget_paise ? (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-hairline">
              <div
                className="h-full rounded-full bg-investment"
                style={{
                  width: `${Math.min(100, (sip.invested_this_month_paise / sip.budget_paise) * 100)}%`,
                }}
              />
            </div>
          ) : null}
          <div className="mt-3">
            <SipBudgetForm budgetPaise={sip.budget_paise} />
          </div>
        </Card>

        <Card>
          <CardTitle>80C / ELSS headroom (this FY)</CardTitle>
          <p className="text-lg font-semibold tnum">
            {formatPaise(Math.max(0, elss.ceiling_paise - elss.invested_fy_paise))}
            <span className="text-sm font-normal text-ink-muted"> remaining</span>
          </p>
          <p className="mt-1 text-xs text-ink-secondary">
            {formatPaise(elss.invested_fy_paise)} of {formatPaise(elss.ceiling_paise)} used ·{" "}
            {elss.months_left} month(s) left
            {elss.months_left > 0 && elss.ceiling_paise > elss.invested_fy_paise
              ? ` → ${formatPaise(
                  Math.round((elss.ceiling_paise - elss.invested_fy_paise) / elss.months_left),
                )}/mo to fill it`
              : ""}
          </p>
        </Card>

        <Card>
          <CardTitle>Allocation</CardTitle>
          {allocation.length === 0 ? (
            <p className="text-sm text-ink-muted">No holdings yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {allocation.map((a) => (
                <li key={a.asset_class} className="flex justify-between">
                  <span className="capitalize text-ink-secondary">{a.asset_class}</span>
                  <span className="tnum">
                    {portfolio > 0 ? `${Math.round((a.value_paise / portfolio) * 100)}%` : "—"} ·{" "}
                    {formatPaise(a.value_paise, { compact: true })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardTitle>Holdings ({formatPaise(portfolio, { compact: true })} total)</CardTitle>
        {holdings.length === 0 ? (
          <EmptyState
            title="No holdings yet"
            hint="Import an MF order book or bootstrap your investments workbook from Settings."
          />
        ) : (
          <Table className="border-0">
            <thead>
              <tr>
                <Th>Fund</Th>
                <Th>Class</Th>
                <Th className="text-right">Units</Th>
                <Th className="text-right">Invested</Th>
                <Th className="text-right">Value</Th>
                <Th className="text-right">P&L</Th>
                <Th>NAV (manual)</Th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h) => {
                const pnl =
                  h.market_value_paise !== null ? h.market_value_paise - h.cost_basis_paise : null;
                return (
                  <tr key={h.fund_id}>
                    <Td className="max-w-64 truncate font-medium">
                      {h.name}
                      {h.is_elss === 1 ? (
                        <span className="ml-1.5">
                          <Badge tone="investment">ELSS</Badge>
                        </span>
                      ) : null}
                    </Td>
                    <Td className="text-xs capitalize text-ink-secondary">
                      {h.asset_class}
                      {h.sub_category ? ` · ${h.sub_category}` : ""}
                    </Td>
                    <Td className="text-right tnum">{h.units.toFixed(3)}</Td>
                    <Td className="text-right tnum">{formatPaise(h.cost_basis_paise)}</Td>
                    <Td className="text-right tnum font-medium">
                      {h.market_value_paise !== null ? formatPaise(h.market_value_paise) : "—"}
                    </Td>
                    <Td
                      className={cx(
                        "text-right tnum",
                        pnl === null ? "text-ink-muted" : pnl >= 0 ? "text-credit" : "text-debit",
                      )}
                    >
                      {pnl !== null ? `${pnl >= 0 ? "+" : ""}${formatPaise(pnl)}` : "set NAV →"}
                    </Td>
                    <Td>
                      <NavEditor fundId={h.fund_id} lastNav={h.last_nav} />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {goals.length > 0 ? (
        <Card>
          <CardTitle>Goal buckets</CardTitle>
          <div className="grid gap-2 md:grid-cols-4">
            {goals.map((g) => (
              <div key={g.id} className="rounded-lg border border-hairline p-2.5">
                <p className="text-xs font-medium text-ink-secondary">{g.name}</p>
                <p className="text-base font-semibold tnum">
                  {g.value_paise !== null ? formatPaise(g.value_paise, { compact: true }) : "—"}
                </p>
                <p className="text-xs text-ink-muted tnum">{g.allocation_pct}% of portfolio</p>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <div className="grid gap-3 xl:grid-cols-2">
        <Card>
          <CardTitle>Fixed deposits</CardTitle>
          {fds.length === 0 ? (
            <p className="text-sm text-ink-muted">None tracked yet.</p>
          ) : (
            <Table className="border-0">
              <thead>
                <tr>
                  <Th>FD</Th>
                  <Th className="text-right">Principal</Th>
                  <Th className="text-right">Rate</Th>
                  <Th>Matures</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {fds.map((fd) => (
                  <tr key={fd.id} className={fd.status !== "active" ? "opacity-50" : ""}>
                    <Td className="font-medium tnum">…{fd.fd_number.slice(-6)}</Td>
                    <Td className="text-right tnum">{formatPaise(fd.principal_paise)}</Td>
                    <Td className="text-right tnum">{(fd.interest_rate_bp / 100).toFixed(2)}%</Td>
                    <Td className="tnum">{fd.maturity_date}</Td>
                    <Td>
                      <FdStatusButton id={fd.id} status={fd.status} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <FdForm />
      </div>
    </>
  );
}
