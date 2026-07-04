"use client";

import { useMemo, useState, useTransition } from "react";
import {
  commitInvestmentBatchAction,
  discardBatchAction,
  updateRowAction,
} from "@/lib/actions/import";
import { Badge, Button, Card, CardTitle, Input, Select, cx } from "@/components/ui";
import { formatPaise } from "@/lib/domain/money";
import type { ImportRowRow } from "@/lib/db/types";
import type { InvestmentReviewData, SchemeGroup } from "@/lib/import/ingest";

/**
 * Review for investment-order imports. The unit of work is the SCHEME, not the
 * row: map each distinct scheme to an instrument (or create one inline) and
 * every order of that scheme follows. Confirmed mappings are remembered as
 * aliases, so repeat imports skip straight through.
 */

interface NewInstrumentDraft {
  name: string;
  instrument_kind: string;
  asset_class: string;
  sub_category: string;
  is_elss: boolean;
  isin: string;
}

type Choice = { kind: "fund"; fundId: number } | { kind: "new"; draft: NewInstrumentDraft } | null;

export function InvestmentReview({
  batchId,
  data,
}: {
  batchId: number;
  data: InvestmentReviewData;
}) {
  const [rows, setRows] = useState(data.rows);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Map<string, Choice>>(() => {
    const m = new Map<string, Choice>();
    for (const g of data.schemes) {
      m.set(g.key, g.suggested_fund_id ? { kind: "fund", fundId: g.suggested_fund_id } : null);
    }
    return m;
  });

  const stats = useMemo(() => {
    const included = rows.filter((r) => !r.parse_error && r.include === 1);
    const dups = rows.filter((r) => r.dup_status === "duplicate").length;
    const unmapped = data.schemes.filter((g) => !choices.get(g.key)).length;
    return { included: included.length, dups, unmapped, parseErrors: rows.filter((r) => r.parse_error).length };
  }, [rows, choices, data.schemes]);

  function setChoice(key: string, choice: Choice) {
    setChoices((prev) => new Map(prev).set(key, choice));
  }

  function commit() {
    setError(null);
    startTransition(async () => {
      const mappings = data.schemes.map((g) => {
        const c = choices.get(g.key);
        if (c?.kind === "fund") return { key: g.key, fund_id: c.fundId };
        if (c?.kind === "new") {
          return {
            key: g.key,
            new_instrument: {
              name: c.draft.name.trim(),
              instrument_kind: c.draft.instrument_kind,
              asset_class: c.draft.asset_class,
              sub_category: c.draft.sub_category.trim() || null,
              is_elss: c.draft.is_elss,
              isin: c.draft.isin.trim() || null,
              platform: null,
            },
          };
        }
        return { key: g.key };
      });
      const res = await commitInvestmentBatchAction(batchId, mappings);
      if (res && !res.ok) setError(res.error ?? "Commit failed.");
    });
  }

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <span>
            <strong className="tnum">{stats.included}</strong> orders to import
          </span>
          <span
            className={cx(
              "rounded-md px-2 py-0.5",
              stats.unmapped > 0 ? "bg-warning-bg text-warning" : "bg-success-bg text-success",
            )}
          >
            {stats.unmapped > 0
              ? `${stats.unmapped} scheme(s) need an instrument`
              : "all schemes mapped ✓"}
          </span>
          {stats.dups > 0 ? (
            <Badge tone="neutral">{stats.dups} duplicates (skipped)</Badge>
          ) : null}
          {stats.parseErrors > 0 ? (
            <Badge tone="danger">{stats.parseErrors} unparseable rows (excluded)</Badge>
          ) : null}
          <span className="ml-auto flex gap-2">
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => startTransition(async () => void (await discardBatchAction(batchId)))}
            >
              Discard
            </Button>
            <Button
              disabled={pending || stats.unmapped > 0}
              title={stats.unmapped > 0 ? "Map every scheme first" : undefined}
              onClick={commit}
            >
              {pending ? "Working…" : `Commit ${stats.included} orders`}
            </Button>
          </span>
        </div>
        {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
      </Card>

      <Card>
        <CardTitle>Schemes in this file → your instruments</CardTitle>
        <div className="space-y-2">
          {data.schemes.map((g) => (
            <SchemeRow
              key={g.key}
              group={g}
              funds={data.funds}
              choice={choices.get(g.key) ?? null}
              onChange={(c) => setChoice(g.key, c)}
            />
          ))}
        </div>
      </Card>

      <div className="overflow-x-auto rounded-xl border border-edge bg-surface">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <Thc>✓</Thc>
              <Thc>Date</Thc>
              <Thc>Scheme</Thc>
              <Thc>Side</Thc>
              <Thc className="text-right">Units</Thc>
              <Thc className="text-right">NAV</Thc>
              <Thc className="text-right">Amount</Thc>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const parsed = safeParsed(row);
              const isDup = row.dup_status === "duplicate";
              return (
                <tr key={row.id} className={cx(isDup && "opacity-45", row.parse_error && "bg-danger-bg/40")}>
                  <Thd>
                    <input
                      type="checkbox"
                      checked={row.include === 1}
                      disabled={Boolean(row.parse_error)}
                      onChange={(e) => {
                        setRows((prev) =>
                          prev.map((r) =>
                            r.id === row.id ? { ...r, include: e.target.checked ? 1 : 0 } : r,
                          ),
                        );
                        startTransition(async () => {
                          await updateRowAction(row.id, { include: e.target.checked });
                        });
                      }}
                    />
                  </Thd>
                  <Thd className="whitespace-nowrap tnum">{row.txn_date ?? "—"}</Thd>
                  <Thd className="max-w-80">
                    <span className="block truncate" title={row.narration ?? ""}>
                      {row.narration}
                    </span>
                    {isDup ? <Badge tone="neutral">already imported</Badge> : null}
                    {row.parse_error ? (
                      <span className="text-xs text-danger">{row.parse_error}</span>
                    ) : null}
                  </Thd>
                  <Thd>
                    {parsed?.side ? (
                      <Badge tone={parsed.side === "sell" ? "debit" : "investment"}>
                        {parsed.side}
                      </Badge>
                    ) : null}
                  </Thd>
                  <Thd className="text-right tnum">{parsed?.units ?? "—"}</Thd>
                  <Thd className="text-right tnum">{parsed?.nav ?? "—"}</Thd>
                  <Thd className="text-right tnum font-medium">
                    {row.amount_paise !== null ? formatPaise(row.amount_paise) : "—"}
                  </Thd>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SchemeRow({
  group,
  funds,
  choice,
  onChange,
}: {
  group: SchemeGroup;
  funds: InvestmentReviewData["funds"];
  choice: Choice;
  onChange: (c: Choice) => void;
}) {
  const selectValue = choice?.kind === "fund" ? String(choice.fundId) : choice?.kind === "new" ? "new" : "";
  const draft: NewInstrumentDraft =
    choice?.kind === "new"
      ? choice.draft
      : {
          name: group.scheme.trim(),
          instrument_kind: "mutual_fund",
          asset_class: "equity",
          sub_category: "",
          is_elss: false,
          isin: "",
        };

  return (
    <div className={cx("rounded-lg border p-2.5", choice ? "border-hairline" : "border-warning")}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-56 flex-1">
          <p className="truncate text-sm font-medium" title={group.scheme}>
            {group.scheme}
          </p>
          <p className="text-xs text-ink-muted tnum">
            {group.order_count} order(s) · {formatPaise(group.total_paise)}
            {group.duplicate_count > 0 ? ` · ${group.duplicate_count} already imported` : ""}
          </p>
        </div>
        <Select
          value={selectValue}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "") onChange(null);
            else if (v === "new") onChange({ kind: "new", draft });
            else onChange({ kind: "fund", fundId: Number(v) });
          }}
          className="w-64 py-1 text-xs"
        >
          <option value="">⚠ Choose instrument…</option>
          {funds.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
          <option value="new">+ Create new instrument</option>
        </Select>
        {group.suggested_fund_id && choice?.kind === "fund" && choice.fundId === group.suggested_fund_id ? (
          <Badge tone="success">auto-matched</Badge>
        ) : null}
      </div>

      {choice?.kind === "new" ? (
        <div className="mt-2 grid grid-cols-2 gap-2 border-t border-hairline pt-2 md:grid-cols-5">
          <label className="col-span-2 flex flex-col gap-1 text-[11px] font-medium text-ink-secondary">
            Name
            <Input
              value={draft.name}
              onChange={(e) => onChange({ kind: "new", draft: { ...draft, name: e.target.value } })}
              className="py-1 text-xs"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-medium text-ink-secondary">
            Kind
            <Select
              value={draft.instrument_kind}
              onChange={(e) =>
                onChange({ kind: "new", draft: { ...draft, instrument_kind: e.target.value } })
              }
              className="py-1 text-xs"
            >
              <option value="mutual_fund">Mutual fund</option>
              <option value="etf">ETF</option>
              <option value="stock">Stock</option>
              <option value="bond">Bond</option>
              <option value="other">Other</option>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-medium text-ink-secondary">
            Asset class
            <Select
              value={draft.asset_class}
              onChange={(e) =>
                onChange({ kind: "new", draft: { ...draft, asset_class: e.target.value } })
              }
              className="py-1 text-xs"
            >
              <option value="equity">Equity</option>
              <option value="debt">Debt</option>
              <option value="gold">Gold</option>
              <option value="elss">ELSS</option>
              <option value="hybrid">Hybrid</option>
              <option value="other">Other</option>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-medium text-ink-secondary">
            Sub-category
            <Input
              value={draft.sub_category}
              placeholder="Mid Cap / Index…"
              onChange={(e) =>
                onChange({ kind: "new", draft: { ...draft, sub_category: e.target.value } })
              }
              className="py-1 text-xs"
            />
          </label>
          <label className="flex items-center gap-1.5 text-[11px] font-medium text-ink-secondary">
            <input
              type="checkbox"
              checked={draft.is_elss}
              onChange={(e) =>
                onChange({ kind: "new", draft: { ...draft, is_elss: e.target.checked } })
              }
            />
            ELSS (80C)
          </label>
        </div>
      ) : null}
    </div>
  );
}

function safeParsed(r: ImportRowRow): { units: number | null; nav: number | null; side: string } | null {
  try {
    return JSON.parse(r.parsed) as { units: number | null; nav: number | null; side: string };
  } catch {
    return null;
  }
}

function Thc({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      className={cx(
        "sticky top-0 border-b border-hairline bg-surface px-2 py-2 text-left text-[11px]",
        "font-semibold uppercase tracking-wider text-ink-muted",
        className,
      )}
    >
      {children}
    </th>
  );
}

function Thd({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <td className={cx("border-b border-hairline/60 px-2 py-1 align-middle", className)}>
      {children}
    </td>
  );
}
