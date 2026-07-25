import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import {
  allocationByClass,
  elssStatus,
  listFixedDeposits,
  listGoals,
  listHoldings,
  listInstruments,
  listInvestmentFys,
  portfolioSummary,
  sipMonthStatus,
  sipTracker,
} from "@/lib/repos/investments";
import { fyStartMonth } from "@/lib/repos/settings";
import { fyLabel, fyStartYear } from "@/lib/domain/fy";
import { formatPaise } from "@/lib/domain/money";
import { Badge, Card, CardTitle, EmptyState, Table, Th, Td, cx } from "@/components/ui";
import {
  FdForm,
  FdRow,
  NavEditor,
  SipBudgetForm,
} from "@/components/investments/investments-client";
import { AddTxnForm, ValuationEditor } from "@/components/investments/holdings-extras";
import { AmfiFetchButton } from "@/components/investments/amfi-controls";
import { InstrumentControls } from "@/components/investments/instrument-controls";
import { getSetting } from "@/lib/repos/settings";

export default function InvestmentsPage(props: PageProps<"/investments">) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Investments</h1>
          <p className="text-sm text-ink-secondary">
            Holdings, SIP progress, tax planning, and fixed deposits. Import broker order history
            via Import.
          </p>
        </div>
        <Link
          href="/investments/plan"
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:opacity-90"
        >
          Target builder →
        </Link>
      </div>
      <Suspense>
        <Content searchParamsPromise={props.searchParams} />
      </Suspense>
    </div>
  );
}

async function Content({
  searchParamsPromise,
}: {
  searchParamsPromise: PageProps<"/investments">["searchParams"];
}) {
  const searchParams = await searchParamsPromise;
  await connection();

  const view =
    searchParams.view === "stocks" || searchParams.view === "mf" ? searchParams.view : "all";
  const showHidden = getSetting<boolean>("show_hidden_investments", true);
  const allHoldings = listHoldings();
  // Hidden filter first (whole-portfolio concept), then the MF/stocks view.
  const visibleHoldings = showHidden ? allHoldings : allHoldings.filter((h) => h.is_hidden === 0);
  const holdings = visibleHoldings.filter((h) => {
    const isDematSide = h.instrument_kind === "stock" || h.instrument_kind === "etf";
    return view === "all" || (view === "stocks" ? isDematSide : !isDematSide);
  });
  const summary = portfolioSummary(holdings);
  const goals = listGoals(visibleHoldings);
  const fds = listFixedDeposits();
  const sip = sipMonthStatus();
  const sips = sipTracker();
  const startMonth = fyStartMonth();
  const elss = elssStatus(fyStartYear(new Date().toISOString().slice(0, 10), startMonth), startMonth);
  const allocation = allocationByClass(holdings);
  const imported = typeof searchParams.imported === "string" ? searchParams.imported : null;

  return (
    <>
      {imported ? (
        <div className="rounded-lg bg-success-bg px-3 py-2 text-sm text-success">
          Imported {imported} order(s)
          {str(searchParams.created) ? `, created ${str(searchParams.created)} instrument(s)` : ""}
          {str(searchParams.skipped) !== "0" && str(searchParams.skipped)
            ? `, ${str(searchParams.skipped)} skipped as duplicates`
            : ""}
          {str(searchParams.linked) !== "0" && str(searchParams.linked)
            ? `; linked ${str(searchParams.linked)} order(s) to bank debits`
            : ""}
          .
        </div>
      ) : null}

      <div className="flex items-center gap-1 rounded-lg border border-edge bg-surface p-0.5 text-xs w-fit">
        {(
          [
            ["mf", "Mutual funds"],
            ["stocks", "Stocks & ETFs"],
            ["all", "All"],
          ] as const
        ).map(([key, label]) => (
          <Link
            key={key}
            href={key === "all" ? "/investments" : `/investments?view=${key}`}
            className={cx(
              "rounded-md px-2.5 py-1",
              view === key ? "bg-hairline font-medium text-ink" : "text-ink-secondary hover:text-ink",
            )}
          >
            {label}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="Invested" value={formatPaise(summary.invested_paise, { compact: true })} tone="text-ink" />
        <Kpi label="Current value" value={formatPaise(summary.value_paise, { compact: true })} tone="text-investment" />
        <Kpi
          label="Unrealized P&L"
          value={`${summary.pnl_paise >= 0 ? "+" : ""}${formatPaise(summary.pnl_paise, { compact: true })}`}
          tone={summary.pnl_paise >= 0 ? "text-credit" : "text-debit"}
        />
        <Kpi
          label="XIRR"
          value={summary.xirr_pct !== null ? `${summary.xirr_pct.toFixed(1)}%` : "—"}
          tone={
            summary.xirr_pct === null
              ? "text-ink-muted"
              : summary.xirr_pct >= 0
                ? "text-credit"
                : "text-debit"
          }
        />
      </div>

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
          <CardTitle>Allocation — actual vs target</CardTitle>
          {allocation.length === 0 ? (
            <p className="text-sm text-ink-muted">No holdings yet.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {allocation.map((a) => (
                <li key={a.asset_class}>
                  <div className="flex justify-between">
                    <span className="capitalize text-ink-secondary">{a.asset_class}</span>
                    <span className="tnum">
                      {a.actual_pct.toFixed(0)}%
                      {a.target_pct !== null ? (
                        <span
                          className={cx(
                            "ml-1",
                            Math.abs(a.actual_pct - a.target_pct) > 5
                              ? "text-warning"
                              : "text-ink-muted",
                          )}
                        >
                          / {a.target_pct}%
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-hairline">
                    <div
                      className="h-full rounded-full bg-investment"
                      style={{ width: `${Math.min(100, a.actual_pct)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <CardTitle>
            Holdings — {formatPaise(summary.value_paise, { compact: true })} across{" "}
            {summary.holding_count} instrument(s)
          </CardTitle>
          <ExportLinks />
          <AmfiFetchButton
            enabled={getSetting<boolean>("amfi_enabled", false)}
            lastFetch={getSetting<string | null>("amfi_last_fetch", null)}
          />
        </div>
        {holdings.length === 0 ? (
          <EmptyState
            title="No holdings yet"
            hint="Import a broker order history (Groww supported out of the box) or add a transaction below."
          />
        ) : (
          <Table className="border-0">
            <thead>
              <tr>
                <Th>Instrument</Th>
                <Th>Class</Th>
                <Th className="text-right">Units</Th>
                <Th className="text-right">Invested</Th>
                <Th className="text-right">Value</Th>
                <Th className="text-right">P&L</Th>
                <Th className="text-right">XIRR</Th>
                <Th>Update</Th>
                <Th>Manage</Th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h) => (
                <tr key={h.fund_id} className={h.is_hidden === 1 ? "opacity-60" : ""}>
                  <Td className="max-w-64 truncate font-medium">
                    {h.name}
                    <span className="ml-1.5 inline-flex gap-1">
                      {h.is_elss === 1 ? <Badge tone="investment">ELSS</Badge> : null}
                      {h.is_observed ? (
                        <span title="Position observed from a statement (e-CAS) — no transactions imported, so cost and P&L are unknown">
                          <Badge tone="neutral">observed</Badge>
                        </span>
                      ) : null}
                      {h.is_hidden === 1 ? <Badge tone="neutral">hidden</Badge> : null}
                    </span>
                  </Td>
                  <Td className="text-xs capitalize text-ink-secondary">
                    {h.asset_class}
                    {h.sub_category ? ` · ${h.sub_category}` : ""}
                  </Td>
                  <Td className="text-right tnum">
                    {h.is_balance_kind ? "—" : h.units.toFixed(3)}
                  </Td>
                  <Td className="text-right tnum">
                    {h.is_observed ? "—" : formatPaise(h.cost_basis_paise)}
                  </Td>
                  <Td className="text-right tnum font-medium">
                    {h.market_value_paise !== null ? formatPaise(h.market_value_paise) : "—"}
                  </Td>
                  <Td
                    className={cx(
                      "text-right tnum",
                      h.pnl_paise === null
                        ? "text-ink-muted"
                        : h.pnl_paise >= 0
                          ? "text-credit"
                          : "text-debit",
                    )}
                  >
                    {h.pnl_paise !== null
                      ? `${h.pnl_paise >= 0 ? "+" : ""}${formatPaise(h.pnl_paise)}`
                      : "—"}
                  </Td>
                  <Td
                    className={cx(
                      "text-right tnum",
                      h.xirr_pct === null
                        ? "text-ink-muted"
                        : h.xirr_pct >= 0
                          ? "text-credit"
                          : "text-debit",
                    )}
                  >
                    {h.xirr_pct !== null ? `${h.xirr_pct.toFixed(1)}%` : "—"}
                  </Td>
                  <Td>
                    {h.is_balance_kind ? (
                      <ValuationEditor fundId={h.fund_id} valuePaise={h.last_valuation_paise} />
                    ) : (
                      <NavEditor fundId={h.fund_id} lastNav={h.last_nav} />
                    )}
                  </Td>
                  <Td>
                    <InstrumentControls
                      fundId={h.fund_id}
                      kind={h.instrument_kind}
                      isSipActive={h.is_sip_active === 1}
                      sipAmountPaise={h.sip_amount_paise}
                      isHidden={h.is_hidden === 1}
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {sips.length > 0 ? (
        <Card>
          <CardTitle>SIP tracker — {sip.month}</CardTitle>
          <ul className="grid gap-1.5 text-sm md:grid-cols-2">
            {sips.map((s) => {
              const done = s.invested_this_month_paise > 0;
              return (
                <li key={s.fund_id} className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-ink-secondary">{s.name}</span>
                  <span className={cx("tnum whitespace-nowrap", done ? "text-success" : "text-warning")}>
                    {done ? `✓ ${formatPaise(s.invested_this_month_paise)}` : "pending"}
                    {s.sip_amount_paise ? (
                      <span className="text-ink-muted"> / {formatPaise(s.sip_amount_paise)}</span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

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

      <AddTxnForm funds={listInstruments().map((f) => ({ id: f.id, name: f.name }))} />

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
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody>
                {fds.map((fd) => (
                  <FdRow key={fd.id} fd={fd} />
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

function str(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

/** Audit export: flat transaction sheet + per-instrument summary, per FY. */
function ExportLinks() {
  const fys = listInvestmentFys();
  if (fys.length === 0) return null;
  const startMonth = fyStartMonth();
  const link = "rounded-md border border-edge px-2 py-1 text-xs text-ink-secondary hover:bg-hairline";
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-ink-muted">Export txns:</span>
      {fys.slice(0, 3).map((y) => (
        <a key={y} href={`/api/export/investments?fy=${y}`} className={link} download>
          {fyLabel(y, startMonth)}
        </a>
      ))}
      <a href="/api/export/investments" className={link} download>
        All
      </a>
    </span>
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
