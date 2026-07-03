import { Suspense } from "react";
import { connection } from "next/server";
import { db } from "@/lib/db/client";
import type { CategoryRow } from "@/lib/db/types";
import { CategoryManager } from "@/components/taxonomy/category-manager";

export default function CategoriesPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Accounts (Categories)</h1>
        <p className="text-sm text-ink-secondary">
          Your ledger buckets — every transaction gets exactly one. Income and expense drive the
          dashboard; <em>transfer</em> categories are excluded from totals.
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
  const categories = db()
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM transactions t WHERE t.category_id = c.id) AS txn_count
       FROM categories c ORDER BY c.sort_order, c.name`,
    )
    .all() as Array<CategoryRow & { txn_count: number }>;
  return <CategoryManager categories={categories} />;
}
