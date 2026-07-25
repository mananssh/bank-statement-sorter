"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addInstrumentAction,
  saveAllocationTargetsAction,
  updateFundSipAction,
} from "@/lib/actions/investments";
import type { ElssStatus } from "@/lib/repos/investments";
import { Badge, Button, Card, CardTitle, Input, Select, cx } from "@/components/ui";
import { formatPaise, parseAmountToPaise } from "@/lib/domain/money";
import type { AllocationTargetRow, FundRow } from "@/lib/db/types";

/**
 * Target builder: a two-level allocation tree (asset classes → optional
 * sub-splits) plus an amount box. Type any amount — the monthly budget or a
 * one-off lumpsum — and each bucket's rupees flow down to its active-SIP
 * instruments, split by weight. Simple target%×amount math, exactly the
 * spreadsheet behavior.
 */

const ASSET_CLASSES = ["equity", "debt", "gold", "elss", "hybrid", "other"] as const;

interface SubSplit {
  name: string;
  pct: string;
}

export function TargetBuilder({
  targets,
  instruments,
  budgetPaise,
  elss,
}: {
  targets: AllocationTargetRow[];
  instruments: FundRow[];
  budgetPaise: number | null;
  elss: ElssStatus;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [tier1, setTier1] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const c of ASSET_CLASSES) {
      const t = targets.find((t) => t.asset_class === c && t.sub_category === "");
      m[c] = t ? String(t.target_pct) : "";
    }
    return m;
  });
  const [subs, setSubs] = useState<Record<string, SubSplit[]>>(() => {
    const m: Record<string, SubSplit[]> = {};
    for (const c of ASSET_CLASSES) {
      m[c] = targets
        .filter((t) => t.asset_class === c && t.sub_category !== "")
        .map((t) => ({ name: t.sub_category, pct: String(t.target_pct) }));
    }
    return m;
  });
  const [amount, setAmount] = useState(
    budgetPaise !== null ? String(Math.round(budgetPaise / 100)) : "",
  );

  const tier1Sum = ASSET_CLASSES.reduce((s, c) => s + (Number(tier1[c]) || 0), 0);
  const amountPaise = parseAmountToPaise(amount) ?? 0;

  interface BucketPlan {
    label: string;
    asset_class: string;
    sub: string;
    pct_of_total: number;
    amount_paise: number;
    instruments: Array<{ fund: FundRow; amount_paise: number }>;
  }

  const buckets: BucketPlan[] = useMemo(() => {
    const out: BucketPlan[] = [];
    for (const c of ASSET_CLASSES) {
      const classPct = Number(tier1[c]) || 0;
      if (classPct <= 0) continue;
      const classSubs = (subs[c] ?? []).filter((s) => s.name.trim() && (Number(s.pct) || 0) > 0);
      const leaves =
        classSubs.length > 0
          ? classSubs.map((s) => ({ sub: s.name.trim(), pct: (classPct * (Number(s.pct) || 0)) / 100 }))
          : [{ sub: "", pct: classPct }];
      for (const leaf of leaves) {
        const bucketAmount = Math.round((amountPaise * leaf.pct) / 100);
        const bucketFunds = instruments.filter(
          (f) =>
            f.is_sip_active === 1 &&
            f.asset_class === c &&
            (leaf.sub === "" ||
              (f.sub_category ?? "").trim().toLowerCase() === leaf.sub.toLowerCase()),
        );
        const totalWeight = bucketFunds.reduce((s, f) => s + (f.sip_weight || 0), 0);
        out.push({
          label: leaf.sub ? `${cap(c)} · ${leaf.sub}` : cap(c),
          asset_class: c,
          sub: leaf.sub,
          pct_of_total: leaf.pct,
          amount_paise: bucketAmount,
          instruments: bucketFunds.map((f) => ({
            fund: f,
            amount_paise:
              totalWeight > 0 ? Math.round((bucketAmount * (f.sip_weight || 0)) / totalWeight) : 0,
          })),
        });
      }
    }
    return out;
  }, [tier1, subs, amountPaise, instruments]);

  function saveTargets() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const rows: Array<{ asset_class: string; sub_category: string; target_pct: number }> = [];
      for (const c of ASSET_CLASSES) {
        const pct = Number(tier1[c]) || 0;
        if (pct > 0) rows.push({ asset_class: c, sub_category: "", target_pct: pct });
        for (const s of subs[c] ?? []) {
          const sp = Number(s.pct) || 0;
          if (s.name.trim() && sp > 0)
            rows.push({ asset_class: c, sub_category: s.name.trim(), target_pct: sp });
        }
      }
      const res = await saveAllocationTargetsAction(rows);
      if (!res.ok) setError(res.error ?? "Could not save targets.");
      else {
        setSaved(true);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="mb-2 flex items-center justify-between">
          <CardTitle>Allocation targets</CardTitle>
          <span
            className={cx(
              "rounded-md px-2 py-0.5 text-xs font-medium tnum",
              Math.abs(tier1Sum - 100) < 0.01
                ? "bg-success-bg text-success"
                : "bg-warning-bg text-warning",
            )}
          >
            total {tier1Sum}%
          </span>
        </div>
        <div className="space-y-2">
          {ASSET_CLASSES.map((c) => (
            <div key={c} className="rounded-lg border border-hairline p-2.5">
              <div className="flex items-center gap-3">
                <span className="w-20 text-sm font-medium capitalize">{c}</span>
                <Input
                  value={tier1[c]}
                  onChange={(e) => setTier1({ ...tier1, [c]: e.target.value })}
                  placeholder="0"
                  inputMode="decimal"
                  className="w-20 py-1 text-right text-sm tnum"
                />
                <span className="text-xs text-ink-muted">%</span>
                {(Number(tier1[c]) || 0) > 0 ? (
                  <button
                    className="ml-auto text-xs text-accent hover:underline"
                    onClick={() =>
                      setSubs({ ...subs, [c]: [...(subs[c] ?? []), { name: "", pct: "" }] })
                    }
                  >
                    + sub-split
                  </button>
                ) : null}
              </div>
              {(subs[c] ?? []).length > 0 ? (
                <div className="mt-2 space-y-1.5 border-t border-hairline pt-2">
                  {(subs[c] ?? []).map((s, i) => (
                    <div key={i} className="flex items-center gap-2 pl-6">
                      <Input
                        value={s.name}
                        placeholder="Large Cap / Index / …"
                        onChange={(e) =>
                          setSubs({
                            ...subs,
                            [c]: subs[c].map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                          })
                        }
                        className="w-48 py-1 text-xs"
                      />
                      <Input
                        value={s.pct}
                        placeholder="0"
                        inputMode="decimal"
                        onChange={(e) =>
                          setSubs({
                            ...subs,
                            [c]: subs[c].map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)),
                          })
                        }
                        className="w-16 py-1 text-right text-xs tnum"
                      />
                      <span className="text-xs text-ink-muted">% of {c}</span>
                      <button
                        onClick={() => setSubs({ ...subs, [c]: subs[c].filter((_, j) => j !== i) })}
                        className="px-1 text-ink-muted hover:text-danger"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <SubSumBadge splits={subs[c] ?? []} />
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button onClick={saveTargets} disabled={pending}>
            {pending ? "Saving…" : "Save targets"}
          </Button>
          {saved ? <span className="text-sm text-success">Saved ✓</span> : null}
          {error ? <span className="text-sm text-danger">{error}</span> : null}
        </div>
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <CardTitle>What to invest</CardTitle>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-ink-secondary">Amount ₹</span>
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              className="w-32 py-1 text-right tnum"
            />
            {budgetPaise !== null ? (
              <button
                className="text-xs text-accent hover:underline"
                onClick={() => setAmount(String(Math.round(budgetPaise / 100)))}
              >
                use budget
              </button>
            ) : null}
          </label>
        </div>

        {buckets.length === 0 ? (
          <p className="text-sm text-ink-muted">Set targets above to see the breakdown.</p>
        ) : (
          <div className="space-y-3">
            {buckets.map((b) => (
              <div key={b.label} className="rounded-lg border border-hairline">
                <div className="flex items-baseline justify-between rounded-t-lg bg-hairline/30 px-3 py-1.5">
                  <span className="text-sm font-medium">{b.label}</span>
                  <span className="text-sm tnum">
                    <span className="text-ink-muted">{b.pct_of_total.toFixed(1)}% → </span>
                    <strong>{formatPaise(b.amount_paise)}</strong>
                  </span>
                </div>
                {b.instruments.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-warning">
                    No active-SIP instrument in this bucket — add one below or mark an existing
                    instrument&apos;s sub-category as “{b.sub || b.asset_class}”.
                  </p>
                ) : (
                  <ul className="divide-y divide-hairline/60">
                    {b.instruments.map(({ fund, amount_paise }) => (
                      <li key={fund.id} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                        <span className="flex-1 truncate">{fund.name}</span>
                        <WeightEditor fund={fund} />
                        <span className="w-28 text-right font-medium tnum">
                          {formatPaise(amount_paise)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
            {elss.ceiling_paise > 0 ? (
              <p className="text-xs text-ink-muted">
                80C note: {formatPaise(Math.max(0, elss.ceiling_paise - elss.invested_fy_paise))}{" "}
                ELSS headroom left this FY
                {elss.months_left > 0
                  ? ` (≈ ${formatPaise(
                      Math.round(
                        Math.max(0, elss.ceiling_paise - elss.invested_fy_paise) /
                          Math.max(1, elss.months_left),
                      ),
                    )}/month to fill it)`
                  : ""}
                .
              </p>
            ) : null}
          </div>
        )}
      </Card>

      <AddInstrumentCard />
    </div>
  );
}

function SubSumBadge({ splits }: { splits: SubSplit[] }) {
  const sum = splits.reduce((s, x) => s + (Number(x.pct) || 0), 0);
  if (splits.length === 0) return null;
  return (
    <p className={cx("pl-6 text-xs tnum", Math.abs(sum - 100) < 0.01 ? "text-success" : "text-warning")}>
      sub-splits total {sum}% {Math.abs(sum - 100) < 0.01 ? "✓" : "(should be 100%)"}
    </p>
  );
}

function WeightEditor({ fund }: { fund: FundRow }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [value, setValue] = useState(String(fund.sip_weight));
  return (
    <label className="flex items-center gap-1 text-xs text-ink-muted">
      wt
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          const w = Number(value);
          if (Number.isFinite(w) && w >= 0 && w !== fund.sip_weight) {
            startTransition(async () => {
              await updateFundSipAction(fund.id, { sip_weight: w });
              router.refresh();
            });
          }
        }}
        inputMode="decimal"
        className="w-14 py-0.5 text-right text-xs tnum"
      />
    </label>
  );
}

function AddInstrumentCard() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  return (
    <Card>
      <CardTitle>Add an instrument</CardTitle>
      <form
        action={(fd) =>
          startTransition(async () => {
            setError(null);
            setSaved(false);
            const res = await addInstrumentAction(fd);
            if (!res.ok) setError(res.error ?? "Could not save.");
            else {
              setSaved(true);
              router.refresh();
            }
          })
        }
        className="grid grid-cols-2 gap-2 md:grid-cols-6"
      >
        <input type="hidden" name="is_sip_active" value="1" />
        <label className="col-span-2 flex flex-col gap-1 text-xs font-medium text-ink-secondary">
          Name
          <Input name="name" required placeholder="HDFC NIFTY 50 Index Direct Growth" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
          Kind
          <Select name="instrument_kind" defaultValue="mutual_fund">
            <option value="mutual_fund">Mutual fund</option>
            <option value="etf">ETF</option>
            <option value="stock">Stock</option>
            <option value="ppf">PPF</option>
            <option value="epf">EPF</option>
            <option value="nps">NPS</option>
            <option value="bond">Bond</option>
            <option value="other">Other</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
          Asset class
          <Select name="asset_class" defaultValue="equity">
            <option value="equity">Equity</option>
            <option value="debt">Debt</option>
            <option value="gold">Gold</option>
            <option value="elss">ELSS</option>
            <option value="hybrid">Hybrid</option>
            <option value="other">Other</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
          Sub-category
          <Input name="sub_category" placeholder="Large Cap" />
        </label>
        <label className="mb-1 flex items-end gap-1.5 text-xs font-medium text-ink-secondary">
          <input type="checkbox" name="is_elss" value="1" className="mb-1" /> ELSS
        </label>
        <div className="col-span-2 flex items-end gap-3 md:col-span-6">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Add instrument"}
          </Button>
          {saved ? <span className="text-sm text-success">Added ✓ (SIP-active by default)</span> : null}
          {error ? <span className="text-sm text-danger">{error}</span> : null}
          <Badge tone="neutral">New instruments start SIP-active with weight 1</Badge>
        </div>
      </form>
    </Card>
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
