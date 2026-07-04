import { Suspense } from "react";
import { connection } from "next/server";
import {
  elssStatus,
  listAllocationTargets,
  listInstruments,
} from "@/lib/repos/investments";
import { fyStartMonth, getSetting } from "@/lib/repos/settings";
import { fyStartYear } from "@/lib/domain/fy";
import { TargetBuilder } from "@/components/investments/target-builder";

export default function PlanPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Target builder</h1>
        <p className="text-sm text-ink-secondary">
          Set your allocation targets once; type any amount and see exactly how much goes into each
          instrument. Targets also power the drift bars on the Investments page.
        </p>
      </div>
      <Suspense>
        <Content />
      </Suspense>
    </div>
  );
}

async function Content() {
  await connection();
  const startMonth = fyStartMonth();
  return (
    <TargetBuilder
      targets={listAllocationTargets()}
      instruments={listInstruments()}
      budgetPaise={getSetting<number | null>("sip_budget_paise", null)}
      elss={elssStatus(fyStartYear(new Date().toISOString().slice(0, 10), startMonth), startMonth)}
    />
  );
}
