"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  setFundHiddenAction,
  toggleShowHiddenInvestmentsAction,
  updateFundSipAction,
  updateInstrumentKindAction,
} from "@/lib/actions/investments";
import { Switch, cx } from "@/components/ui";
import type { InstrumentKind } from "@/lib/db/types";

const KIND_OPTIONS: Array<[InstrumentKind, string]> = [
  ["mutual_fund", "MF"],
  ["stock", "Stock"],
  ["etf", "ETF"],
  ["ppf", "PPF"],
  ["epf", "EPF"],
  ["nps", "NPS"],
  ["bond", "Bond"],
  ["other", "Other"],
];

function EyeIcon({ off, className }: { off?: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {off ? (
        <>
          <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19" />
          <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </>
      ) : (
        <>
          <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

/**
 * Per-holding management block: reclassify kind (fixes the occasional wrong
 * MF/ETF guess), mark as an active SIP with its monthly amount (so the SIP
 * tracker only shows what you actually opted in), and hide/unhide (for
 * holdings — e.g. a family/legacy demat position — you don't want cluttering
 * your own portfolio view).
 */
export function InstrumentControls({
  fundId,
  kind,
  isSipActive,
  sipAmountPaise,
  isHidden,
}: {
  fundId: number;
  kind: InstrumentKind;
  isSipActive: boolean;
  sipAmountPaise: number | null;
  isHidden: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [sipOn, setSipOn] = useState(isSipActive);
  const [amount, setAmount] = useState(sipAmountPaise !== null ? String(sipAmountPaise / 100) : "");
  const [hidden, setHidden] = useState(isHidden);

  return (
    <div className="flex w-40 flex-col gap-1.5 rounded-lg border border-hairline bg-page/40 p-1.5">
      <select
        defaultValue={kind}
        onChange={(e) =>
          startTransition(async () => {
            await updateInstrumentKindAction(fundId, e.target.value);
            router.refresh();
          })
        }
        className={cx(
          "w-full rounded-md border border-edge bg-surface px-1.5 py-1 text-xs font-medium text-ink",
          "focus:border-accent focus:outline-none",
        )}
      >
        {KIND_OPTIONS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>

      <div className="flex items-center gap-1.5">
        <Switch
          size="sm"
          checked={sipOn}
          onChange={(next) => {
            setSipOn(next);
            startTransition(async () => {
              await updateFundSipAction(fundId, { is_sip_active: next });
              router.refresh();
            });
          }}
        />
        <span className="text-[11px] font-medium text-ink-secondary">SIP</span>
        {sipOn ? (
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onBlur={() => {
              startTransition(async () => {
                await updateFundSipAction(fundId, { sip_amount: amount });
                router.refresh();
              });
            }}
            placeholder="₹/mo"
            inputMode="decimal"
            className="w-full min-w-0 rounded-md border border-edge bg-surface px-1.5 py-0.5 text-right text-xs tnum focus:border-accent focus:outline-none"
          />
        ) : null}
      </div>

      <button
        type="button"
        onClick={() =>
          startTransition(async () => {
            const next = !hidden;
            setHidden(next);
            await setFundHiddenAction(fundId, next);
            router.refresh();
          })
        }
        className="inline-flex items-center gap-1 self-start text-[11px] font-medium text-ink-muted hover:text-ink"
      >
        <EyeIcon off={hidden} className="h-3 w-3" />
        {hidden ? "Unhide" : "Hide"}
      </button>
    </div>
  );
}

/** Settings toggle: whether hidden instruments still show on the Investments page. */
export function ShowHiddenInvestmentsToggle({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [checked, setChecked] = useState(enabled);
  const [pending, startTransition] = useTransition();
  return (
    <label className="flex items-start gap-2.5 text-sm">
      <Switch
        checked={checked}
        disabled={pending}
        onChange={(next) => {
          setChecked(next);
          startTransition(async () => {
            await toggleShowHiddenInvestmentsAction(next);
            router.refresh();
          });
        }}
        className="mt-0.5"
      />
      <span>
        <span className="font-medium">Show hidden investments</span>
        <span className="block text-xs text-ink-secondary">
          Instruments you&apos;ve marked &quot;Hide&quot; on the Investments page (e.g. a
          family/legacy holding) stay hidden from the holdings table and portfolio totals
          when this is off. Default: on.
        </span>
      </span>
    </label>
  );
}
