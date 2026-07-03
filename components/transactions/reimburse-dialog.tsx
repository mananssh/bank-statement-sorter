"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  reimburseInfoAction,
  saveReimburseAction,
  type ReimburseInfo,
} from "@/lib/actions/transactions";
import { Badge, Button, Input, Select, cx } from "@/components/ui";
import { formatPaise } from "@/lib/domain/money";
import type { CategoryRow } from "@/lib/db/types";

/**
 * "This payback covers x, y, z." Allocate an incoming credit across the
 * expense heads it repays (portions must add up to the full amount) and
 * optionally tick the original payments it settles — a pure audit trail,
 * amounts don't have to match.
 */

interface PortionDraft {
  category_id: number | "";
  rupees: string; // user-facing decimal string; converted to paise on save
}

export function ReimburseDialog({
  txnId,
  amountPaise,
  categoryId,
  display,
  splitCount,
  categories,
}: {
  txnId: number;
  amountPaise: number;
  categoryId: number | null;
  display: string;
  splitCount: number;
  categories: CategoryRow[]; // expense + investment heads only
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [portions, setPortions] = useState<PortionDraft[]>([]);
  const [candidates, setCandidates] = useState<ReimburseInfo["candidates"]>([]);
  const [linked, setLinked] = useState<Set<number>>(new Set());

  const allocatedPaise = useMemo(
    () =>
      portions.reduce((s, p) => {
        const n = Number(p.rupees);
        return s + (Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0);
      }, 0),
    [portions],
  );
  const remainder = amountPaise - allocatedPaise;
  const valid =
    portions.length > 0 && remainder === 0 && portions.every((p) => p.category_id !== "");

  async function openDialog() {
    setOpen(true);
    setLoading(true);
    setError(null);
    try {
      const info = await reimburseInfoAction(txnId, categoryId ? [categoryId] : []);
      if (info.splits.length > 0) {
        setPortions(
          info.splits.map((s) => ({
            category_id: s.category_id,
            rupees: (s.amount_paise / 100).toFixed(2),
          })),
        );
      } else {
        // Start with the whole amount on the current head (if it's a
        // netting-capable one) so a two-way split is one edit away.
        const isNettable = categories.some((c) => c.id === categoryId);
        setPortions([
          {
            category_id: isNettable && categoryId ? categoryId : "",
            rupees: (amountPaise / 100).toFixed(2),
          },
        ]);
      }
      setCandidates(info.candidates);
      setLinked(new Set(info.linkedDebitIds));
    } catch {
      setError("Could not load split details.");
    } finally {
      setLoading(false);
    }
  }

  function save() {
    startTransition(async () => {
      const res = await saveReimburseAction({
        txnId,
        portions: portions.map((p) => ({
          category_id: Number(p.category_id),
          amount_paise: Math.round(Number(p.rupees) * 100),
        })),
        linkedDebitIds: [...linked],
      });
      if (!res.ok) {
        setError(res.error ?? "Save failed.");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        onClick={openDialog}
        title="Split this payback across categories / link the payments it repays"
        className={cx(
          "rounded px-1 text-xs hover:bg-accent/10",
          splitCount > 0 ? "font-medium text-accent" : "text-ink-muted hover:text-accent",
        )}
      >
        {splitCount > 0 ? `⇄ ×${splitCount}` : "⇄"}
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-edge bg-surface-raised p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold">Payback split</h2>
              <span className="tnum text-sm font-medium text-credit">
                +{formatPaise(amountPaise)}
              </span>
            </div>
            <p className="mb-3 truncate text-xs text-ink-muted" title={display}>
              {display}
            </p>

            {loading ? (
              <p className="py-6 text-center text-sm text-ink-muted">Loading…</p>
            ) : (
              <>
                <div className="space-y-1.5">
                  {portions.map((p, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <Select
                        value={p.category_id}
                        onChange={(e) =>
                          setPortions((prev) =>
                            prev.map((x, j) =>
                              j === i
                                ? { ...x, category_id: e.target.value ? Number(e.target.value) : "" }
                                : x,
                            ),
                          )
                        }
                        className="flex-1 py-1 text-xs"
                      >
                        <option value="">Choose head…</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </Select>
                      <Input
                        inputMode="decimal"
                        value={p.rupees}
                        onChange={(e) =>
                          setPortions((prev) =>
                            prev.map((x, j) => (j === i ? { ...x, rupees: e.target.value } : x)),
                          )
                        }
                        className="w-28 py-1 text-right text-xs tnum"
                      />
                      <button
                        onClick={() => setPortions((prev) => prev.filter((_, j) => j !== i))}
                        className="px-1 text-ink-muted hover:text-danger"
                        title="Remove"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>

                <div className="mt-2 flex items-center justify-between text-xs">
                  <button
                    onClick={() =>
                      setPortions((prev) => [
                        ...prev,
                        {
                          category_id: "",
                          rupees: remainder > 0 ? (remainder / 100).toFixed(2) : "",
                        },
                      ])
                    }
                    className="text-accent hover:underline"
                  >
                    + add head
                  </button>
                  <span
                    className={cx(
                      "tnum",
                      remainder === 0 ? "text-success" : "font-medium text-warning",
                    )}
                  >
                    {remainder === 0
                      ? "fully allocated ✓"
                      : remainder > 0
                        ? `${formatPaise(remainder)} left to allocate`
                        : `${formatPaise(-remainder)} over`}
                  </span>
                </div>

                {candidates.length > 0 ? (
                  <div className="mt-4 border-t border-hairline pt-3">
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-ink-muted">
                      Repays these payments{" "}
                      <span className="font-normal normal-case">(optional — audit trail)</span>
                    </p>
                    <ul className="max-h-44 space-y-0.5 overflow-y-auto">
                      {candidates.map((c) => (
                        <li key={c.id}>
                          <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-hairline/40">
                            <input
                              type="checkbox"
                              checked={linked.has(c.id)}
                              onChange={(e) =>
                                setLinked((prev) => {
                                  const next = new Set(prev);
                                  if (e.target.checked) next.add(c.id);
                                  else next.delete(c.id);
                                  return next;
                                })
                              }
                            />
                            <span className="tnum whitespace-nowrap text-ink-muted">
                              {c.txn_date}
                            </span>
                            <span className="flex-1 truncate" title={c.display}>
                              {c.display}
                            </span>
                            {c.category_name ? <Badge tone="neutral">{c.category_name}</Badge> : null}
                            <span className="tnum font-medium text-debit">
                              −{formatPaise(c.amount_paise)}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}

                <div className="mt-4 flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                    Cancel
                  </Button>
                  <Button onClick={save} disabled={pending || !valid}>
                    {pending ? "Saving…" : "Save split"}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
