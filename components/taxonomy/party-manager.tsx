"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { mergePartiesAction, updatePartyAction } from "@/lib/actions/taxonomy";
import { Button, Select, Table, Th, Td } from "@/components/ui";
import type { CategoryRow, PartyRow } from "@/lib/db/types";

export function PartyManager({
  parties,
  categories,
}: {
  parties: Array<PartyRow & { txn_count: number; aliases: string | null }>;
  categories: CategoryRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mergeSource, setMergeSource] = useState<number | "">("");
  const [mergeTarget, setMergeTarget] = useState<number | "">("");
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-edge bg-surface p-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
          Merge duplicate parties — from
          <Select
            value={mergeSource}
            onChange={(e) => setMergeSource(Number(e.target.value) || "")}
          >
            <option value="">Choose…</option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.canonical_name}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
          into
          <Select
            value={mergeTarget}
            onChange={(e) => setMergeTarget(Number(e.target.value) || "")}
          >
            <option value="">Choose…</option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.canonical_name}
              </option>
            ))}
          </Select>
        </label>
        <Button
          variant="ghost"
          disabled={pending || !mergeSource || !mergeTarget}
          onClick={() =>
            startTransition(async () => {
              const res = await mergePartiesAction(Number(mergeSource), Number(mergeTarget));
              if (!res.ok) setError(res.error ?? "Merge failed.");
              else {
                setMergeSource("");
                setMergeTarget("");
                router.refresh();
              }
            })
          }
        >
          Merge
        </Button>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
      </div>

      <Table>
        <thead>
          <tr>
            <Th>Party</Th>
            <Th>Known aliases / VPAs</Th>
            <Th className="text-right">Transactions</Th>
            <Th>Default category</Th>
          </tr>
        </thead>
        <tbody>
          {parties.map((p) => (
            <tr key={p.id}>
              <Td className="font-medium">{p.canonical_name}</Td>
              <Td className="max-w-64 truncate text-xs text-ink-muted" >
                <span title={p.aliases ?? ""}>{p.aliases ?? "—"}</span>
              </Td>
              <Td className="text-right tnum">{p.txn_count.toLocaleString("en-IN")}</Td>
              <Td>
                <Select
                  defaultValue={p.default_category_id ?? ""}
                  className="w-44 py-1 text-xs"
                  onChange={(e) =>
                    startTransition(async () => {
                      await updatePartyAction(p.id, {
                        default_category_id: e.target.value ? Number(e.target.value) : null,
                      });
                    })
                  }
                >
                  <option value="">—</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
