import { Suspense } from "react";
import { connection } from "next/server";
import { listCategories, listRules } from "@/lib/repos/lookups";
import { RuleManager } from "@/components/taxonomy/rule-manager";

export default function RulesPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Categorization rules</h1>
        <p className="text-sm text-ink-secondary">
          Lower priority wins. Learned memory from your confirmations always outranks rules; seed
          rules (900+) are shipped defaults you can edit or disable.
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
  return <RuleManager rules={listRules()} categories={listCategories()} />;
}
