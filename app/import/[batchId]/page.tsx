import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import {
  getBatch,
  listBatchSheets,
  analyzeSheet,
  listBatchRows,
  getInvestmentReviewData,
} from "@/lib/import/ingest";
import { listAccounts, listCategories, listParties, listPresets } from "@/lib/repos/lookups";
import { PasswordForm } from "@/components/import/password-form";
import { SheetPicker } from "@/components/import/sheet-picker";
import { MappingWizard } from "@/components/import/mapping-wizard";
import { ReviewTable } from "@/components/import/review-table";
import { InvestmentReview } from "@/components/import/investment-review";

export default function BatchPage(props: PageProps<"/import/[batchId]">) {
  return (
    <Suspense>
      <BatchContent paramsPromise={props.params} />
    </Suspense>
  );
}

async function BatchContent({
  paramsPromise,
}: {
  paramsPromise: PageProps<"/import/[batchId]">["params"];
}) {
  const { batchId: batchIdStr } = await paramsPromise;
  const batchId = Number(batchIdStr);
  await connection();
  const batch = getBatch(batchId);
  if (!batch || Number.isNaN(batchId)) notFound();
  if (batch.status !== "staging") redirect("/import");

  const meta = JSON.parse(batch.meta) as { step?: string };
  const step = meta.step ?? "sheet";

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Import: {batch.file_name}</h1>
        <StepIndicator step={step} />
      </div>
      <StepBody batchId={batchId} step={step} sheetName={batch.sheet_name} />
    </div>
  );
}

function StepIndicator({ step }: { step: string }) {
  const steps = ["password", "sheet", "mapping", "review"];
  const activeIdx = steps.indexOf(step);
  return (
    <ol className="flex items-center gap-2 text-xs">
      {["Unlock", "Sheet", "Mapping", "Review"].map((label, i) => (
        <li
          key={label}
          className={
            i === activeIdx
              ? "rounded-md bg-accent/10 px-2 py-0.5 font-medium text-accent"
              : i < activeIdx
                ? "text-ink-secondary line-through decoration-hairline"
                : "text-ink-muted"
          }
        >
          {label}
        </li>
      ))}
    </ol>
  );
}

async function StepBody({
  batchId,
  step,
  sheetName,
}: {
  batchId: number;
  step: string;
  sheetName: string | null;
}) {
  if (step === "password") {
    return <PasswordForm batchId={batchId} />;
  }

  if (step === "sheet") {
    let sheets: string[];
    try {
      sheets = (await listBatchSheets(batchId)).sheets;
    } catch {
      // Server restarted mid-wizard: the in-memory password is gone.
      return <PasswordForm batchId={batchId} lostSession />;
    }
    if (sheets.length === 1) {
      await analyzeSheet(batchId, sheets[0]);
      redirect(`/import/${batchId}`);
    }
    return <SheetPicker batchId={batchId} sheets={sheets} />;
  }

  if (step === "mapping" && sheetName) {
    const analysis = await analyzeSheet(batchId, sheetName);
    return (
      <MappingWizard
        batchId={batchId}
        preview={analysis.preview}
        detection={analysis.detection}
        matchedPreset={analysis.matchedPreset}
        accounts={listAccounts()}
        presets={listPresets()}
      />
    );
  }

  if (step === "review") {
    const batch = getBatch(batchId);
    if (batch?.statement_kind === "mf_orders") {
      return <InvestmentReview batchId={batchId} data={getInvestmentReviewData(batchId)} />;
    }
    return (
      <ReviewTable
        batchId={batchId}
        rows={listBatchRows(batchId)}
        categories={listCategories()}
        parties={listParties().map((p) => ({ id: p.id, name: p.canonical_name }))}
      />
    );
  }

  redirect("/import");
}
