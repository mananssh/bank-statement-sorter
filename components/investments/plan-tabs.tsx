"use client";

import { useState, type ReactNode } from "react";
import { cx } from "@/components/ui";

/**
 * The two halves of the target builder answer different questions and compose
 * rather than compete: allocation decides what a SIP buys, goals decide who
 * owns the units it bought. Both are always live — the toggle only picks which
 * one you are editing.
 */

const MODES = [
  {
    key: "allocation" as const,
    label: "By allocation",
    blurb: "Split an amount across asset classes and instruments — what to buy.",
  },
  {
    key: "goals" as const,
    label: "By goal",
    blurb: "Claim a share of each SIP's units for a goal — who owns what you bought.",
  },
];

export function PlanTabs({
  allocation,
  goals,
}: {
  allocation: ReactNode;
  goals: ReactNode;
}) {
  const [mode, setMode] = useState<"allocation" | "goals">("allocation");
  const current = MODES.find((m) => m.key === mode)!;

  return (
    <div className="space-y-3">
      <div>
        <div
          role="tablist"
          aria-label="Target builder mode"
          className="inline-flex rounded-lg border border-edge bg-surface p-0.5"
        >
          {MODES.map((m) => (
            <button
              key={m.key}
              role="tab"
              aria-selected={mode === m.key}
              onClick={() => setMode(m.key)}
              className={cx(
                "rounded-md px-3 py-1 text-sm font-medium transition-colors",
                mode === m.key
                  ? "bg-accent text-accent-ink"
                  : "text-ink-secondary hover:text-ink",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-ink-muted">{current.blurb}</p>
      </div>
      {mode === "allocation" ? allocation : goals}
    </div>
  );
}
