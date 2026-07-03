import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { listTransactions, type TxnFilters } from "@/lib/repos/transactions";
import { listAccounts, listCategories, listFyYears } from "@/lib/repos/lookups";
import { fyStartMonth } from "@/lib/repos/settings";
import { fyLabel } from "@/lib/domain/fy";
import { formatPaise } from "@/lib/domain/money";
import { Badge, Table, Th, Td, EmptyState, cx } from "@/components/ui";
import { TxnCategoryEditor } from "@/components/transactions/txn-inline-editor";

const PAGE_SIZE = 100;

export default function TransactionsPage(props: PageProps<"/transactions">) {
  return (
    <Suspense>
      <TransactionsContent searchParamsPromise={props.searchParams} />
    </Suspense>
  );
}

function str(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

async function TransactionsContent({
  searchParamsPromise,
}: {
  searchParamsPromise: PageProps<"/transactions">["searchParams"];
}) {
  const searchParams = await searchParamsPromise;
  await connection();

  const page = Number(str(searchParams.page) ?? "1") || 1;
  const filters: TxnFilters = {
    fyStartYear: str(searchParams.fy) ? Number(str(searchParams.fy)) : undefined,
    month: str(searchParams.month),
    accountId: str(searchParams.account) ? Number(str(searchParams.account)) : undefined,
    categoryId: str(searchParams.category) ? Number(str(searchParams.category)) : undefined,
    partyId: str(searchParams.party) ? Number(str(searchParams.party)) : undefined,
    untagged: str(searchParams.untagged) === "1",
    q: str(searchParams.q),
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };

  const { rows, total } = listTransactions(filters);
  const accounts = listAccounts();
  const categories = listCategories();
  const fyYears = listFyYears();
  const startMonth = fyStartMonth();
  const imported = str(searchParams.imported);

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Transactions</h1>
        <p className="text-sm text-ink-muted tnum">{total.toLocaleString("en-IN")} matching</p>
      </div>

      {imported ? (
        <div className="rounded-lg bg-success-bg px-3 py-2 text-sm text-success">
          Imported {imported} transaction(s)
          {str(searchParams.skipped) !== "0" && str(searchParams.skipped)
            ? `, ${str(searchParams.skipped)} skipped as duplicates`
            : ""}
          {str(searchParams.transfers) !== "0" && str(searchParams.transfers)
            ? `; ${str(searchParams.transfers)} possible transfer(s) detected — review on the dashboard`
            : ""}
          .
        </div>
      ) : null}

      <form method="get" className="flex flex-wrap items-end gap-2 rounded-xl border border-edge bg-surface p-3 text-xs">
        <FilterSelect name="fy" label="Financial year" value={str(searchParams.fy) ?? ""}>
          <option value="">All</option>
          {fyYears.map((y) => (
            <option key={y} value={y}>
              {fyLabel(y, startMonth)}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect name="account" label="Account" value={str(searchParams.account) ?? ""}>
          <option value="">All</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect name="category" label="Category" value={str(searchParams.category) ?? ""}>
          <option value="">All</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </FilterSelect>
        <label className="flex flex-col gap-1 font-medium text-ink-secondary">
          Search
          <input
            type="search"
            name="q"
            defaultValue={str(searchParams.q) ?? ""}
            placeholder="narration, payee, note…"
            className="w-48 rounded-lg border border-edge bg-surface px-2.5 py-1.5 text-sm"
          />
        </label>
        <label className="mb-1.5 flex items-center gap-1.5 font-medium text-ink-secondary">
          <input type="checkbox" name="untagged" value="1" defaultChecked={filters.untagged} />
          Untagged only
        </label>
        <button
          type="submit"
          className="mb-0.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink"
        >
          Filter
        </button>
        <Link href="/transactions" className="mb-1.5 text-ink-muted hover:text-ink">
          reset
        </Link>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          title="No transactions match"
          hint="Import a statement or loosen the filters."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Account</Th>
              <Th>Narration / Party</Th>
              <Th className="text-right">Amount</Th>
              <Th className="text-right">Balance</Th>
              <Th>Account (Category)</Th>
              <Th>Tagged by</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className={cx(t.is_transfer === 1 && "opacity-50")}>
                <Td className="whitespace-nowrap tnum">{t.txn_date}</Td>
                <Td className="whitespace-nowrap text-xs text-ink-secondary">{t.account_name}</Td>
                <Td className="max-w-md">
                  <span className="block truncate font-medium" title={t.narration}>
                    {t.party_name ?? t.counterparty_raw ?? t.narration}
                  </span>
                  <span className="block truncate text-xs text-ink-muted" title={t.narration}>
                    {t.description ?? t.upi_note ?? t.narration}
                  </span>
                </Td>
                <Td
                  className={cx(
                    "whitespace-nowrap text-right tnum font-medium",
                    t.is_transfer === 1
                      ? "text-transfer"
                      : t.direction === "credit"
                        ? "text-credit"
                        : "text-debit",
                  )}
                >
                  {t.direction === "credit" ? "+" : "−"}
                  {formatPaise(t.amount_paise)}
                </Td>
                <Td className="whitespace-nowrap text-right tnum text-ink-secondary">
                  {t.balance_paise !== null ? formatPaise(t.balance_paise) : "—"}
                </Td>
                <Td>
                  {t.is_transfer === 1 ? (
                    <Badge tone="transfer">transfer</Badge>
                  ) : (
                    <TxnCategoryEditor
                      txnId={t.id}
                      categoryId={t.category_id}
                      categories={categories}
                    />
                  )}
                </Td>
                <Td>
                  {t.categorized_by ? (
                    <Badge tone={t.categorized_by === "manual" ? "neutral" : "success"}>
                      {t.categorized_by.replace("_", " ")}
                    </Badge>
                  ) : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {total > PAGE_SIZE ? (
        <Pagination page={page} total={total} searchParams={searchParams} />
      ) : null}
    </div>
  );
}

function FilterSelect({
  name,
  label,
  value,
  children,
}: {
  name: string;
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 font-medium text-ink-secondary">
      {label}
      <select
        name={name}
        defaultValue={value}
        className="rounded-lg border border-edge bg-surface px-2.5 py-1.5 text-sm"
      >
        {children}
      </select>
    </label>
  );
}

function Pagination({
  page,
  total,
  searchParams,
}: {
  page: number;
  total: number;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const pages = Math.ceil(total / PAGE_SIZE);
  const qs = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (typeof v === "string" && v && k !== "page") params.set(k, v);
    }
    params.set("page", String(p));
    return `/transactions?${params}`;
  };
  return (
    <div className="flex items-center justify-center gap-3 text-sm">
      {page > 1 ? (
        <Link className="text-accent" href={qs(page - 1)}>
          ← Newer
        </Link>
      ) : null}
      <span className="text-ink-muted tnum">
        page {page} / {pages}
      </span>
      {page < pages ? (
        <Link className="text-accent" href={qs(page + 1)}>
          Older →
        </Link>
      ) : null}
    </div>
  );
}
