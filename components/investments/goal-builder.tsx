"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createGoalAction,
  deleteGoalAction,
  equalizeGoalSharesAction,
  setGoalArchivedAction,
  updateGoalAction,
} from "@/lib/actions/goals";
import type { GoalAttribution, GoalFundSlice, GoalView } from "@/lib/repos/goals";
import { Badge, Button, Card, CardTitle, EmptyState, Input, cx } from "@/components/ui";
import { formatPaise } from "@/lib/domain/money";
import { seriesColorFor } from "@/lib/ui/colors";

/**
 * Goal mode: goals claim a share of the UNITS of every SIP purchase made on or
 * after their start date, which makes each goal a real sub-portfolio with its
 * own invested amount, value and return — rather than a flat percentage of
 * today's total. Shares need not reach 100%; the rest stays unassigned.
 */

export function GoalBuilder({ attribution }: { attribution: GoalAttribution }) {
  const active = attribution.goals.filter((g) => g.is_archived === 0);
  const archived = attribution.goals.filter((g) => g.is_archived === 1);
  const claimed = active.reduce((s, g) => s + g.sip_share_pct, 0);
  const unclaimed = Math.max(0, 100 - claimed);

  return (
    <div className="space-y-4">
      <GoalListCard
        active={active}
        archived={archived}
        claimed={claimed}
        overAllocated={attribution.over_allocated}
      />

      {active.length > 0 || attribution.unassigned.cost_paise > 0 ? (
        <Card>
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
            <CardTitle>Where your SIP units have gone</CardTitle>
            <span className="text-xs text-ink-muted tnum">
              {attribution.purchases} SIP purchase{attribution.purchases === 1 ? "" : "s"}{" "}
              attributed
            </span>
          </div>
          <p className="mb-3 text-xs text-ink-secondary">
            Each goal owns units, not rupees — so invested and current value are both real, and
            the slices always add back up to each fund&apos;s true unit count.
          </p>
          <div className="space-y-2">
            {active.map((g) => (
              <BucketRow
                key={g.id}
                label={g.name}
                sublabel={`${g.sip_share_pct}% of each SIP since ${g.start_date}`}
                colorId={g.id}
                cost={g.cost_paise}
                value={g.value_paise}
                pnl={g.pnl_paise}
                xirr={g.xirr_pct}
                slices={g.slices}
              />
            ))}
            <BucketRow
              label="Unassigned"
              sublabel={
                unclaimed > 0
                  ? `${unclaimed.toFixed(1)}% of each SIP is unclaimed, plus anything bought before your first goal`
                  : "Bought before your first goal started"
              }
              colorId={0}
              muted
              cost={attribution.unassigned.cost_paise}
              value={attribution.unassigned.value_paise}
              pnl={attribution.unassigned.pnl_paise}
              xirr={null}
              slices={attribution.unassigned.slices}
            />
          </div>
          <Notes attribution={attribution} />
        </Card>
      ) : null}

      <AddGoalCard unclaimed={unclaimed} hasGoals={active.length > 0} />
    </div>
  );
}

function GoalListCard({
  active,
  archived,
  claimed,
  overAllocated,
}: {
  active: GoalView[];
  archived: GoalView[];
  claimed: number;
  overAllocated: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <CardTitle>Goals</CardTitle>
        <div className="flex items-center gap-2">
          {active.length > 1 ? (
            <button
              className="text-xs text-accent hover:underline disabled:opacity-50"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await equalizeGoalSharesAction();
                  router.refresh();
                })
              }
            >
              split equally
            </button>
          ) : null}
          <span
            className={cx(
              "rounded-md px-2 py-0.5 text-xs font-medium tnum",
              overAllocated
                ? "bg-danger-bg text-danger"
                : Math.abs(claimed - 100) < 0.01
                  ? "bg-success-bg text-success"
                  : "bg-hairline/50 text-ink-secondary",
            )}
          >
            {claimed.toFixed(1)}% of each SIP claimed
          </span>
        </div>
      </div>

      {active.length === 0 && archived.length === 0 ? (
        <EmptyState
          title="No goals yet"
          hint="Add one below — say “Property” from the date you started saving for it, taking 40% of every SIP."
        />
      ) : (
        <div className="space-y-2">
          {active.map((g) => (
            // The editor's fields are uncontrolled, so key on the server values
            // too: a mutation elsewhere (splitting equally) has to remount the
            // row for its defaults to pick the new numbers up.
            <GoalEditor
              key={`${g.id}:${g.name}:${g.start_date}:${g.sip_share_pct}`}
              goal={g}
            />
          ))}
          {archived.length > 0 ? (
            <div className="space-y-1.5 border-t border-hairline pt-2">
              <p className="text-xs font-medium text-ink-muted">Archived — claims nothing</p>
              {archived.map((g) => (
                <div key={g.id} className="flex items-center gap-3 px-1 text-sm">
                  <span className="flex-1 truncate text-ink-secondary">{g.name}</span>
                  <button
                    className="text-xs text-accent hover:underline"
                    onClick={() =>
                      startTransition(async () => {
                        await setGoalArchivedAction(g.id, false);
                        router.refresh();
                      })
                    }
                  >
                    restore
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
      {overAllocated ? (
        <p className="mt-2 text-xs text-danger">
          Goal shares add up to more than 100% of each SIP, so units are being over-claimed. Lower
          a share to fix the totals.
        </p>
      ) : null}
    </Card>
  );
}

function GoalEditor({ goal }: { goal: GoalView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="rounded-lg border border-hairline p-2.5">
      <form
        action={(fd) =>
          startTransition(async () => {
            setError(null);
            const res = await updateGoalAction(goal.id, fd);
            if (!res.ok) setError(res.error ?? "Could not save.");
            else router.refresh();
          })
        }
        className="flex flex-wrap items-end gap-2"
      >
        <span
          className="mb-2 h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: seriesColorFor(goal.id) }}
        />
        <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-ink-secondary">
          Goal
          <Input name="name" defaultValue={goal.name} required className="py-1 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
          Investing since
          <Input
            name="start_date"
            type="date"
            defaultValue={goal.start_date}
            required
            className="py-1 text-sm tnum"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
          Share of each SIP
          <div className="flex items-center gap-1">
            <Input
              name="share_pct"
              defaultValue={String(goal.sip_share_pct)}
              inputMode="decimal"
              className="w-20 py-1 text-right text-sm tnum"
            />
            <span className="text-xs text-ink-muted">%</span>
          </div>
        </label>
        <Button type="submit" variant="ghost" disabled={pending} className="mb-0.5">
          {pending ? "Saving…" : "Save"}
        </Button>
        <button
          type="button"
          className="mb-2 text-xs text-ink-muted hover:underline"
          onClick={() =>
            startTransition(async () => {
              await setGoalArchivedAction(goal.id, true);
              router.refresh();
            })
          }
        >
          archive
        </button>
        {confirming ? (
          <span className="mb-2 flex items-center gap-1.5 text-xs">
            <span className="text-ink-secondary">Delete?</span>
            <button
              type="button"
              className="font-medium text-danger hover:underline"
              onClick={() =>
                startTransition(async () => {
                  await deleteGoalAction(goal.id);
                  router.refresh();
                })
              }
            >
              yes
            </button>
            <button
              type="button"
              className="text-ink-muted hover:underline"
              onClick={() => setConfirming(false)}
            >
              no
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="mb-2 text-xs text-ink-muted hover:text-danger"
            onClick={() => setConfirming(true)}
          >
            delete
          </button>
        )}
      </form>
      {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
    </div>
  );
}

function BucketRow({
  label,
  sublabel,
  colorId,
  cost,
  value,
  pnl,
  xirr,
  slices,
  muted,
}: {
  label: string;
  sublabel: string;
  colorId: number;
  cost: number;
  value: number | null;
  pnl: number | null;
  xirr: number | null;
  slices: GoalFundSlice[];
  muted?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-hairline">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-3 py-2 text-left"
        aria-expanded={open}
      >
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: muted ? "var(--ink-muted)" : seriesColorFor(colorId) }}
        />
        <span className="min-w-0 flex-1">
          <span className={cx("block truncate text-sm font-medium", muted && "text-ink-secondary")}>
            {label}
          </span>
          <span className="block truncate text-xs text-ink-muted">{sublabel}</span>
        </span>
        <span className="hidden text-right sm:block">
          <span className="block text-xs text-ink-muted">invested</span>
          <span className="block text-sm tnum">{formatPaise(cost, { compact: true })}</span>
        </span>
        <span className="w-24 text-right">
          <span className="block text-xs text-ink-muted">value</span>
          <span className="block text-sm font-medium tnum">
            {value !== null ? formatPaise(value, { compact: true }) : "—"}
          </span>
        </span>
        <span className="w-24 text-right">
          <span className="block text-xs text-ink-muted">gain</span>
          {pnl !== null ? (
            <span className={cx("block text-sm tnum", pnl >= 0 ? "text-credit" : "text-debit")}>
              {pnl >= 0 ? "+" : ""}
              {formatPaise(pnl, { compact: true })}
              {xirr !== null ? (
                <span className="ml-1 text-xs text-ink-muted">{xirr.toFixed(1)}%</span>
              ) : null}
            </span>
          ) : (
            <span className="block text-sm text-ink-muted">—</span>
          )}
        </span>
        <span className="w-3 shrink-0 text-xs text-ink-muted">{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        slices.length === 0 ? (
          <p className="border-t border-hairline px-3 py-2 text-xs text-ink-muted">
            No units yet — no SIP purchase has fallen on or after this start date.
          </p>
        ) : (
          <ul className="divide-y divide-hairline/60 border-t border-hairline">
            {slices.map((s) => (
              <li key={s.fund_id} className="flex items-center gap-3 px-3 py-1.5 text-xs">
                <span className="min-w-0 flex-1 truncate">{s.fund_name}</span>
                <span className="w-24 text-right text-ink-secondary tnum">
                  {s.units.toFixed(3)} u
                </span>
                <span className="w-24 text-right text-ink-secondary tnum">
                  {formatPaise(s.cost_paise, { compact: true })}
                </span>
                <span className="w-24 text-right font-medium tnum">
                  {s.value_paise !== null ? formatPaise(s.value_paise, { compact: true }) : "—"}
                </span>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

function Notes({ attribution }: { attribution: GoalAttribution }) {
  const notes: string[] = [];
  if (attribution.purchases_before_any_goal > 0) {
    notes.push(
      `${attribution.purchases_before_any_goal} purchase${
        attribution.purchases_before_any_goal === 1 ? "" : "s"
      } predate every goal's start date, so they sit in Unassigned.`,
    );
  }
  for (const f of attribution.excluded_funds) {
    notes.push(
      `${f.name} has ${f.txns} purchase${f.txns === 1 ? "" : "s"} but is not SIP-active, so goals skip it.`,
    );
  }
  if (notes.length === 0) return null;
  return (
    <ul className="mt-3 space-y-1 border-t border-hairline pt-2">
      {notes.map((n) => (
        <li key={n} className="text-xs text-ink-muted">
          {n}
        </li>
      ))}
    </ul>
  );
}

function AddGoalCard({ unclaimed, hasGoals }: { unclaimed: number; hasGoals: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  return (
    <Card>
      <CardTitle>Add a goal</CardTitle>
      <form
        action={(fd) =>
          startTransition(async () => {
            setError(null);
            setSaved(false);
            const res = await createGoalAction(fd);
            if (!res.ok) setError(res.error ?? "Could not save.");
            else {
              setSaved(true);
              router.refresh();
            }
          })
        }
        className="mt-2 flex flex-wrap items-end gap-2"
      >
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs font-medium text-ink-secondary">
          Goal
          <Input name="name" required placeholder="Property investment" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
          Investing since
          <Input
            name="start_date"
            type="date"
            required
            defaultValue={new Date().toISOString().slice(0, 10)}
            className="tnum"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
          Share of each SIP
          <div className="flex items-center gap-1">
            <Input
              name="share_pct"
              inputMode="decimal"
              defaultValue={hasGoals ? "" : "100"}
              placeholder={unclaimed.toFixed(1)}
              className="w-20 text-right tnum"
            />
            <span className="text-xs text-ink-muted">%</span>
          </div>
        </label>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Add goal"}
        </Button>
        {saved ? <span className="mb-2 text-sm text-success">Added ✓</span> : null}
        {error ? <span className="mb-2 text-sm text-danger">{error}</span> : null}
        <Badge tone="neutral">{unclaimed.toFixed(1)}% of each SIP still unclaimed</Badge>
      </form>
    </Card>
  );
}
