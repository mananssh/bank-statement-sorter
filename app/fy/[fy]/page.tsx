import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { fyDateRange, fyLabel, fyMonths, monthLabel } from "@/lib/domain/fy";
import { fyStartMonth } from "@/lib/repos/settings";
import { monthlyRollup } from "@/lib/repos/reports";
import { listTransactions } from "@/lib/repos/transactions";
import { formatPaise } from "@/lib/domain/money";
import { Card, CardTitle, Table, Th, Td, EmptyState, cx } from "@/components/ui";

const PAGE_SIZE = 200;

/**
 * The on-screen "supersheet": one financial year, month filter chips, the
 * ledger in mastersheet column order, and the Consolidator-style summary —
 * plus one-click export of the whole FY workbook.
 */
export default function FyPage(props: PageProps<"/fy/[fy]">) {
  return (
    <Suspense>
      <FyContent paramsPromise={props.params} searchParamsPromise={props.searchParams} />
    </Suspense>
  );
}

async function FyContent({
  paramsPromise,
  searchParamsPromise,
}: {
  paramsPromise: PageProps<"/fy/[fy]">["params"];
  searchParamsPromise: PageProps<"/fy/[fy]">["searchParams"];
}) {
  const { fy: fyStr } = await paramsPromise;
  const searchParams = await searchParamsPromise;
  const month = typeof searchParams.month === "string" ? searchParams.month : undefined;
  const page = Number((typeof searchParams.page === "string" && searchParams.page) || "1") || 1;
  await connection();
  const fy = Number(fyStr);
  if (!Number.isInteger(fy) || fy < 1990 || fy > 2100) notFound();

  const startMonth = fyStartMonth();
  const label = fyLabel(fy, startMonth);
  const { from, to } = fyDateRange(fy, startMonth);
  const months = fyMonths(fy, startMonth);
  const rollup = monthlyRollup(from, to);
  const rollupByMonth = new Map(rollup.map((r) => [r.month, r]));

  const { rows, total } = listTransactions({
    fyStartYear: fy,
    month,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold">{label}</h1>
          <span className="flex gap-2 text-sm">
            <Link href={`/fy/${fy - 1}`} className="text-accent hover:underline">
              ← {fyLabel(fy - 1, startMonth)}
            </Link>
            <Link href={`/fy/${fy + 1}`} className="text-accent hover:underline">
              {fyLabel(fy + 1, startMonth)} →
            </Link>
          </span>
        </div>
        <a
          href={`/api/export/fy/${fy}`}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:opacity-90"
        >
          ⬇ Export {label} workbook
        </a>
      </div>

      <Card>
        <CardTitle>Yearly summary</CardTitle>
        <Table className="border-0">
          <thead>
            <tr>
              <Th>Month</Th>
              <Th className="text-right">Income</Th>
              <Th className="text-right">Expenses</Th>
              <Th className="text-right">Invested</Th>
              <Th className="text-right">Net flow</Th>
              <Th className="text-right">Savings rate</Th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => {
              const r = rollupByMonth.get(m);
              return (
                <tr key={m} className={r ? "" : "opacity-40"}>
                  <Td>
                    <Link href={`/fy/${fy}?month=${m}`} className="font-medium hover:text-accent">
                      {monthLabel(m)}
                    </Link>
                  </Td>
                  <Td className="text-right tnum text-credit">
                    {r ? formatPaise(r.credits_paise) : "—"}
                  </Td>
                  <Td className="text-right tnum text-debit">
                    {r ? formatPaise(r.debits_paise) : "—"}
                  </Td>
                  <Td className="text-right tnum text-investment">
                    {r ? formatPaise(r.investments_paise) : "—"}
                  </Td>
                  <Td
                    className={cx(
                      "text-right tnum font-medium",
                      r && r.net_flow_paise < 0 ? "text-debit" : "text-credit",
                    )}
                  >
                    {r ? formatPaise(r.net_flow_paise) : "—"}
                  </Td>
                  <Td className="text-right tnum">
                    {r?.savings_rate !== null && r ? `${Math.round(r.savings_rate * 100)}%` : "—"}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      <div className="flex flex-wrap gap-1.5">
        <MonthChip href={`/fy/${fy}`} active={!month} label="All months" />
        {months.map((m) => (
          <MonthChip
            key={m}
            href={`/fy/${fy}?month=${m}`}
            active={month === m}
            label={monthLabel(m).replace(/ \d{4}$/, "")}
          />
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No transactions here" hint="Import statements covering this period." />
      ) : (
        <>
          <p className="text-xs text-ink-muted tnum">{total.toLocaleString("en-IN")} transaction(s)</p>
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Narration</Th>
                <Th>Ref</Th>
                <Th className="text-right">Debit</Th>
                <Th className="text-right">Credit</Th>
                <Th className="text-right">Balance</Th>
                <Th>Party</Th>
                <Th>Account (Category)</Th>
                <Th>Description</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className={cx(t.is_transfer === 1 && "opacity-50")}>
                  <Td className="whitespace-nowrap tnum">{t.txn_date}</Td>
                  <Td className="max-w-72 truncate text-xs" >
                    <span title={t.narration}>{t.narration}</span>
                  </Td>
                  <Td className="max-w-24 truncate text-xs text-ink-muted">{t.ref_number}</Td>
                  <Td className="text-right tnum text-debit">
                    {t.direction === "debit" ? formatPaise(t.amount_paise) : ""}
                  </Td>
                  <Td className="text-right tnum text-credit">
                    {t.direction === "credit" ? formatPaise(t.amount_paise) : ""}
                  </Td>
                  <Td className="text-right tnum text-ink-secondary">
                    {t.balance_paise !== null ? formatPaise(t.balance_paise) : ""}
                  </Td>
                  <Td className="max-w-36 truncate text-xs">{t.party_name}</Td>
                  <Td className="max-w-36 truncate text-xs font-medium">{t.category_name ?? "⚠"}</Td>
                  <Td className="max-w-36 truncate text-xs text-ink-secondary">{t.description}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {total > PAGE_SIZE ? <FyPagination fy={fy} month={month} page={page} total={total} /> : null}
        </>
      )}
    </div>
  );
}

function FyPagination({
  fy,
  month,
  page,
  total,
}: {
  fy: number;
  month: string | undefined;
  page: number;
  total: number;
}) {
  const pages = Math.ceil(total / PAGE_SIZE);
  const qs = (p: number) => {
    const params = new URLSearchParams();
    if (month) params.set("month", month);
    params.set("page", String(p));
    return `/fy/${fy}?${params}`;
  };
  return (
    <div className="flex items-center justify-center gap-3 text-sm">
      {page > 1 ? (
        <Link className="text-accent hover:underline" href={qs(page - 1)}>
          ← Newer
        </Link>
      ) : null}
      <span className="text-ink-muted tnum">
        page {page} / {pages}
      </span>
      {page < pages ? (
        <Link className="text-accent hover:underline" href={qs(page + 1)}>
          Older →
        </Link>
      ) : null}
    </div>
  );
}

function MonthChip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={cx(
        "rounded-lg px-2.5 py-1 text-xs font-medium",
        active
          ? "bg-accent text-accent-ink"
          : "border border-edge text-ink-secondary hover:bg-hairline/40",
      )}
    >
      {label}
    </Link>
  );
}
