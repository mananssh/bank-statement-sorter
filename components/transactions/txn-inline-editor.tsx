"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateTxnAction } from "@/lib/actions/transactions";
import { Select, cx } from "@/components/ui";
import type { CategoryRow } from "@/lib/db/types";

export function TxnCategoryEditor({
  txnId,
  categoryId,
  categories,
}: {
  txnId: number;
  categoryId: number | null;
  categories: CategoryRow[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(categoryId);
  const [, startTransition] = useTransition();

  return (
    <Select
      value={value ?? ""}
      onChange={(e) => {
        const next = e.target.value ? Number(e.target.value) : null;
        setValue(next);
        startTransition(async () => {
          await updateTxnAction(txnId, { category_id: next });
          router.refresh();
        });
      }}
      className={cx("w-44 py-1 text-xs", value === null && "border-warning")}
    >
      <option value="">⚠ Untagged</option>
      {categories.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </Select>
  );
}
