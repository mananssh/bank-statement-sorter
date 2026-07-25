"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  setFundHiddenAction,
  toggleShowHiddenInvestmentsAction,
  updateFundSipAction,
  updateInstrumentKindAction,
} from "@/lib/actions/investments";
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

/**
 * Per-holding management row: reclassify kind (fixes the occasional wrong
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

  return (
    <div className="flex flex-col gap-1 text-xs">
      <select
        defaultValue={kind}
        onChange={(e) =>
          startTransition(async () => {
            await updateInstrumentKindAction(fundId, e.target.value);
            router.refresh();
          })
        }
        className="rounded border border-edge bg-transparent px-1 py-0.5 text-xs"
      >
        {KIND_OPTIONS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>

      <label className="flex items-center gap-1 text-ink-secondary">
        <input
          type="checkbox"
          checked={sipOn}
          onChange={(e) => {
            const next = e.target.checked;
            setSipOn(next);
            startTransition(async () => {
              await updateFundSipAction(fundId, { is_sip_active: next });
              router.refresh();
            });
          }}
        />
        SIP
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
            className="w-16 rounded border border-edge bg-transparent px-1 py-0.5 text-right tnum"
          />
        ) : null}
      </label>

      <button
        type="button"
        onClick={() =>
          startTransition(async () => {
            await setFundHiddenAction(fundId, !isHidden);
            router.refresh();
          })
        }
        className="text-left text-accent hover:underline"
      >
        {isHidden ? "Unhide" : "Hide"}
      </button>
    </div>
  );
}

/** Settings toggle: whether hidden instruments still show on the Investments page. */
export function ShowHiddenInvestmentsToggle({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        defaultChecked={enabled}
        disabled={pending}
        className="mt-0.5"
        onChange={(e) =>
          startTransition(async () => {
            await toggleShowHiddenInvestmentsAction(e.target.checked);
            router.refresh();
          })
        }
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
