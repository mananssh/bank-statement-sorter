import { Suspense } from "react";
import { connection } from "next/server";
import { listCategories, listParties } from "@/lib/repos/lookups";
import { PartyManager } from "@/components/taxonomy/party-manager";
import { EmptyState } from "@/components/ui";

export default function PartiesPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Parties</h1>
        <p className="text-sm text-ink-secondary">
          Who you actually transact with — auto-created from statement narrations. Set a default
          category and every future transaction with that party tags itself.
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
  const parties = listParties();
  if (parties.length === 0) {
    return (
      <EmptyState
        title="No parties yet"
        hint="Parties appear automatically as you import and categorize statements."
      />
    );
  }
  return <PartyManager parties={parties} categories={listCategories()} />;
}
