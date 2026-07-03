"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateTxnAction } from "@/lib/actions/transactions";
import { Select, cx } from "@/components/ui";
import type { CategoryRow, Direction } from "@/lib/db/types";

const TYPES_FOR_DIRECTION: Record<Direction, string[]> = {
  credit: ["income", "transfer", "expense", "investment"],
  debit: ["expense", "investment", "transfer"],
};

const TYPE_LABEL: Record<string, string> = {
  income: "Income",
  expense: "Expenses",
  investment: "Investments",
  transfer: "Transfers",
};

function groupLabel(type: string, direction: Direction): string {
  if (direction === "credit" && (type === "expense" || type === "investment")) {
    return `↩ Payback → ${TYPE_LABEL[type]}`;
  }
  return TYPE_LABEL[type] ?? type;
}

export function TxnCategoryEditor({
  txnId,
  categoryId,
  direction,
  categories,
}: {
  txnId: number;
  categoryId: number | null;
  direction: Direction;
  categories: CategoryRow[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(categoryId);
  const [, startTransition] = useTransition();

  const catsByType = useMemo(() => {
    const m: Record<string, CategoryRow[]> = {};
    for (const c of categories) (m[c.type] ??= []).push(c);
    return m;
  }, [categories]);

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
      {TYPES_FOR_DIRECTION[direction].map((type) =>
        catsByType[type]?.length ? (
          <optgroup key={type} label={groupLabel(type, direction)}>
            {catsByType[type].map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
        ) : null,
      )}
    </Select>
  );
}
