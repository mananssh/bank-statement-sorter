"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  bulkApplyAction,
  bulkTagUntaggedAction,
  commitBatchAction,
  discardBatchAction,
  setRowPartyAction,
  updateRowAction,
} from "@/lib/actions/import";
import { Badge, Button, Card, Input, Select, cx, type BadgeTone } from "@/components/ui";
import { formatPaise } from "@/lib/domain/money";
import type { CategoryRow, Direction, ImportRowRow } from "@/lib/db/types";

/**
 * The confirm/correct loop. Suggested categories show a source badge; edits
 * save per row as you go (so the batch is a resumable draft). Committing is
 * blocked until nothing is untagged, and runs as a single transaction.
 */

const SOURCE_TONE: Record<string, BadgeTone> = {
  memory: "success",
  party_default: "success",
  rule: "info",
  seed: "warning",
};

// Which category types may apply to money-in vs money-out.
const TYPES_FOR_DIRECTION: Record<Direction, string[]> = {
  credit: ["income", "transfer"],
  debit: ["expense", "investment", "transfer"],
};

const TYPE_LABEL: Record<string, string> = {
  income: "Income",
  expense: "Expenses",
  investment: "Investments",
  transfer: "Transfers",
};

export function ReviewTable({
  batchId,
  rows: initialRows,
  categories,
  parties: initialParties,
}: {
  batchId: number;
  rows: ImportRowRow[];
  categories: CategoryRow[];
  parties: Array<{ id: number; name: string }>;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [parties, setParties] = useState(initialParties);
  const [onlyUntagged, setOnlyUntagged] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const catsByType = useMemo(() => {
    const m: Record<string, CategoryRow[]> = {};
    for (const c of categories) (m[c.type] ??= []).push(c);
    return m;
  }, [categories]);

  const stats = useMemo(() => {
    const parseErrors = rows.filter((r) => r.parse_error).length;
    const dups = rows.filter((r) => r.dup_status === "duplicate").length;
    const possible = rows.filter((r) => r.dup_status === "possible_duplicate").length;
    const included = rows.filter((r) => r.include === 1 && !r.parse_error);
    const untagged = included.filter(
      (r) => (r.user_category_id ?? r.suggested_category_id) === null,
    ).length;
    return { parseErrors, dups, possible, included: included.length, untagged };
  }, [rows]);

  const visible = useMemo(
    () =>
      onlyUntagged
        ? rows.filter(
            (r) =>
              !r.parse_error &&
              r.include === 1 &&
              (r.user_category_id ?? r.suggested_category_id) === null,
          )
        : rows,
    [rows, onlyUntagged],
  );

  function patchRow(id: number, patch: Partial<ImportRowRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function setCategory(row: ImportRowRow, categoryId: number | null) {
    patchRow(row.id, { user_category_id: categoryId });
    startTransition(async () => {
      await updateRowAction(row.id, { category_id: categoryId });
    });
  }

  function setParty(row: ImportRowRow, name: string) {
    startTransition(async () => {
      const res = await setRowPartyAction(row.id, name);
      const party = res.data ?? null;
      patchRow(row.id, { user_party_id: party?.id ?? null });
      if (party && !parties.some((p) => p.id === party.id)) {
        setParties((prev) => [...prev, party].sort((a, b) => a.name.localeCompare(b.name)));
      }
    });
  }

  function bulkApply(row: ImportRowRow) {
    const categoryId = row.user_category_id ?? row.suggested_category_id;
    if (!categoryId) return;
    startTransition(async () => {
      const res = await bulkApplyAction(row.id, categoryId);
      if (res.ok && typeof res.data === "number") {
        setNotice(`Applied to ${res.data} row(s) with the same payee.`);
        const key = payeeDisplay(row);
        setRows((prev) =>
          prev.map((r) => (payeeDisplay(r) === key ? { ...r, user_category_id: categoryId } : r)),
        );
      }
    });
  }

  function bulkTag(categoryId: number, type: string) {
    const directions = type === "income" ? ["credit"] : type === "transfer" ? ["credit", "debit"] : ["debit"];
    startTransition(async () => {
      const res = await bulkTagUntaggedAction(batchId, categoryId);
      if (res.ok) {
        setRows((prev) =>
          prev.map((r) =>
            r.include === 1 &&
            !r.parse_error &&
            (r.user_category_id ?? r.suggested_category_id) === null &&
            r.direction &&
            directions.includes(r.direction)
              ? { ...r, user_category_id: categoryId }
              : r,
          ),
        );
        setNotice(`Tagged ${res.data ?? 0} untagged ${TYPE_LABEL[type]?.toLowerCase() ?? ""} row(s).`);
      }
    });
  }

  const commitBlocked = stats.untagged > 0;

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <span>
            <strong className="tnum">{stats.included}</strong> to import
          </span>
          <button
            onClick={() => setOnlyUntagged(!onlyUntagged)}
            className={cx(
              "rounded-md px-2 py-0.5",
              stats.untagged > 0 ? "bg-warning-bg text-warning" : "bg-success-bg text-success",
              onlyUntagged && "ring-1 ring-current",
            )}
          >
            {stats.untagged} untagged {onlyUntagged ? "· showing only these" : "· click to filter"}
          </button>
          {stats.dups > 0 ? <Badge tone="neutral">{stats.dups} duplicates (skipped)</Badge> : null}
          {stats.possible > 0 ? (
            <Badge tone="warning">{stats.possible} possible duplicates — check below</Badge>
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
            <Button variant="ghost" disabled={pending} onClick={() => router.push("/import")}>
              Save &amp; finish later
            </Button>
            <Button
              disabled={pending || commitBlocked}
              title={commitBlocked ? "Tag every row before committing" : undefined}
              onClick={() =>
                startTransition(async () => {
                  const res = await commitBatchAction(batchId);
                  if (res && !res.ok) setError(res.error ?? "Commit failed.");
                })
              }
            >
              {pending ? "Working…" : `Commit ${stats.included} transactions`}
            </Button>
          </span>
        </div>

        {/* Bulk "tag all untagged" pickers, one per type. */}
        {stats.untagged > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-hairline pt-3 text-xs">
            <span className="text-ink-muted">Tag all untagged as:</span>
            {(["expense", "income", "investment"] as const).map((type) =>
              catsByType[type]?.length ? (
                <label key={type} className="flex items-center gap-1">
                  <span className="text-ink-secondary">{TYPE_LABEL[type]}</span>
                  <Select
                    value=""
                    disabled={pending}
                    className="py-1 text-xs"
                    onChange={(e) => {
                      const id = Number(e.target.value);
                      if (id) bulkTag(id, type);
                      e.target.value = "";
                    }}
                  >
                    <option value="">choose…</option>
                    {catsByType[type].map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </label>
              ) : null,
            )}
          </div>
        ) : null}

        {commitBlocked ? (
          <p className="mt-2 text-xs text-warning">
            Commit is disabled until every row is tagged. Your edits are saved — you can leave and
            resume this import anytime from the Import page.
          </p>
        ) : null}
        {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
        {notice ? <p className="mt-2 text-sm text-success">{notice}</p> : null}
      </Card>

      <datalist id="party-options">
        {parties.map((p) => (
          <option key={p.id} value={p.name} />
        ))}
      </datalist>

      <div className="overflow-x-auto rounded-xl border border-edge bg-surface">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <Thc>✓</Thc>
              <Thc>Date</Thc>
              <Thc>Narration</Thc>
              <Thc className="text-right">Amount</Thc>
              <Thc>Account (Category)</Thc>
              <Thc>Party</Thc>
              <Thc>Description</Thc>
              <Thc>Source</Thc>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const categoryId = row.user_category_id ?? row.suggested_category_id;
              const isDup = row.dup_status === "duplicate";
              const isUntagged = !row.parse_error && row.include === 1 && categoryId === null;
              const allowedTypes = row.direction ? TYPES_FOR_DIRECTION[row.direction] : [];
              return (
                <tr
                  key={row.id}
                  className={cx(
                    isDup && "opacity-45",
                    row.parse_error && "bg-danger-bg/40",
                    isUntagged && "bg-warning-bg/40",
                  )}
                >
                  <Tdc>
                    <input
                      type="checkbox"
                      checked={row.include === 1}
                      disabled={Boolean(row.parse_error)}
                      onChange={(e) => {
                        patchRow(row.id, { include: e.target.checked ? 1 : 0 });
                        startTransition(async () => {
                          await updateRowAction(row.id, { include: e.target.checked });
                        });
                      }}
                    />
                  </Tdc>
                  <Tdc className="whitespace-nowrap tnum">{row.txn_date ?? "—"}</Tdc>
                  <Tdc className="max-w-72">
                    <span className="block truncate" title={row.narration ?? ""}>
                      {row.counterparty_raw || row.narration}
                    </span>
                    {row.upi_note ? (
                      <span className="block truncate text-xs text-ink-muted">“{row.upi_note}”</span>
                    ) : null}
                    {row.parse_error ? (
                      <span className="text-xs text-danger">{row.parse_error}</span>
                    ) : null}
                    {row.dup_status === "possible_duplicate" ? (
                      <Badge tone="warning">possible duplicate</Badge>
                    ) : null}
                  </Tdc>
                  <Tdc
                    className={cx(
                      "whitespace-nowrap text-right tnum font-medium",
                      row.direction === "credit" ? "text-credit" : "text-debit",
                    )}
                  >
                    {row.amount_paise !== null
                      ? `${row.direction === "credit" ? "+" : "−"}${formatPaise(row.amount_paise)}`
                      : "—"}
                  </Tdc>
                  <Tdc>
                    {!row.parse_error ? (
                      <div className="flex items-center gap-1">
                        <Select
                          value={categoryId ?? ""}
                          onChange={(e) =>
                            setCategory(row, e.target.value ? Number(e.target.value) : null)
                          }
                          className={cx("w-44 py-1 text-xs", isUntagged && "border-warning")}
                        >
                          <option value="">⚠ Untagged</option>
                          {allowedTypes.map((type) =>
                            catsByType[type]?.length ? (
                              <optgroup key={type} label={TYPE_LABEL[type] ?? type}>
                                {catsByType[type].map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.name}
                                  </option>
                                ))}
                              </optgroup>
                            ) : null,
                          )}
                        </Select>
                        {categoryId ? (
                          <button
                            title="Apply to all rows with this payee"
                            onClick={() => bulkApply(row)}
                            className="rounded px-1 text-xs text-accent hover:bg-accent/10"
                          >
                            ⇊
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </Tdc>
                  <Tdc>
                    {!row.parse_error ? (
                      <Input
                        list="party-options"
                        defaultValue={partyName(row, parties)}
                        placeholder="—"
                        className="w-40 py-1 text-xs"
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v !== partyName(row, parties)) setParty(row, v);
                        }}
                      />
                    ) : null}
                  </Tdc>
                  <Tdc>
                    {!row.parse_error ? (
                      <Input
                        defaultValue={row.description ?? row.upi_note ?? ""}
                        placeholder="—"
                        className="w-36 py-1 text-xs"
                        onBlur={(e) => {
                          const v = e.target.value || null;
                          if (v !== row.description) {
                            patchRow(row.id, { description: v });
                            startTransition(async () => {
                              await updateRowAction(row.id, { description: v });
                            });
                          }
                        }}
                      />
                    ) : null}
                  </Tdc>
                  <Tdc>
                    {row.suggestion_source && row.user_category_id === null ? (
                      <Badge tone={SOURCE_TONE[row.suggestion_source] ?? "neutral"}>
                        {row.suggestion_source.replace("_", " ")}
                      </Badge>
                    ) : row.user_category_id !== null ? (
                      <Badge tone="neutral">manual</Badge>
                    ) : null}
                  </Tdc>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function payeeDisplay(row: ImportRowRow): string {
  return row.counterparty_vpa ?? row.counterparty_raw ?? row.narration ?? String(row.id);
}

function partyName(row: ImportRowRow, parties: Array<{ id: number; name: string }>): string {
  const id = row.user_party_id ?? row.suggested_party_id;
  if (id) return parties.find((p) => p.id === id)?.name ?? "";
  return row.counterparty_raw ?? "";
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

function Tdc({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <td className={cx("border-b border-hairline/60 px-2 py-1 align-middle", className)}>
      {children}
    </td>
  );
}
