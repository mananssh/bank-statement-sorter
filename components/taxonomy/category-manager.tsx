"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createCategoryAction,
  deleteCategoryAction,
  toggleCategoryAction,
} from "@/lib/actions/taxonomy";
import { Badge, Button, Input, Select, Table, Th, Td, type BadgeTone } from "@/components/ui";
import type { CategoryRow } from "@/lib/db/types";

const TYPE_TONE: Record<string, BadgeTone> = {
  income: "credit",
  expense: "debit",
  investment: "investment",
  transfer: "transfer",
};

export function CategoryManager({
  categories,
}: {
  categories: Array<CategoryRow & { txn_count: number }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", type: "expense" });

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          startTransition(async () => {
            const res = await createCategoryAction(form);
            if (!res.ok) setError(res.error ?? "Failed.");
            else {
              setForm({ name: "", type: form.type });
              router.refresh();
            }
          });
        }}
      >
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
          New category
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Pet Care"
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
          Type
          <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="income">Income</option>
            <option value="expense">Expense</option>
            <option value="investment">Investment</option>
            <option value="transfer">Transfer</option>
          </Select>
        </label>
        <Button type="submit" disabled={pending}>
          Add
        </Button>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
      </form>

      <Table>
        <thead>
          <tr>
            <Th>Name</Th>
            <Th>Type</Th>
            <Th className="text-right">Transactions</Th>
            <Th>Status</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {categories.map((c) => (
            <tr key={c.id} className={c.is_active ? "" : "opacity-50"}>
              <Td className="font-medium">{c.name}</Td>
              <Td>
                <Badge tone={TYPE_TONE[c.type]}>{c.type}</Badge>
              </Td>
              <Td className="text-right tnum">{c.txn_count.toLocaleString("en-IN")}</Td>
              <Td>
                <button
                  className="text-xs text-accent hover:underline"
                  onClick={() =>
                    startTransition(async () => {
                      await toggleCategoryAction(c.id, c.is_active !== 1);
                      router.refresh();
                    })
                  }
                >
                  {c.is_active === 1 ? "active — deactivate" : "inactive — activate"}
                </button>
              </Td>
              <Td>
                {c.txn_count === 0 ? (
                  <button
                    className="text-xs text-danger hover:underline"
                    onClick={() =>
                      startTransition(async () => {
                        const res = await deleteCategoryAction(c.id);
                        if (!res.ok) setError(res.error ?? "Failed.");
                        else router.refresh();
                      })
                    }
                  >
                    delete
                  </button>
                ) : null}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
