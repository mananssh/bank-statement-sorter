"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createRuleAction,
  deleteRuleAction,
  testRuleAction,
  toggleRuleAction,
} from "@/lib/actions/taxonomy";
import { Badge, Button, Card, CardTitle, Input, Select, Table, Th, Td } from "@/components/ui";
import { formatPaise } from "@/lib/domain/money";
import type { CategoryRow, RuleRow } from "@/lib/db/types";

type TestMatch = {
  id: number;
  txn_date: string;
  narration: string;
  amount_paise: number;
  direction: string;
};

export function RuleManager({
  rules,
  categories,
}: {
  rules: Array<RuleRow & { category_name: string }>;
  categories: CategoryRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<{ total: number; matches: TestMatch[] } | null>(null);
  const [form, setForm] = useState({
    category_id: 0,
    field: "narration",
    match_type: "contains",
    pattern: "",
    direction: "" as "" | "debit" | "credit",
    priority: 100,
  });

  function payload() {
    return {
      ...form,
      category_id: form.category_id,
      direction: form.direction || null,
      priority: Number(form.priority) || 100,
    };
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>New rule</CardTitle>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="When">
            <Select
              value={form.field}
              onChange={(e) => setForm({ ...form, field: e.target.value })}
            >
              <option value="narration">Narration</option>
              <option value="counterparty">Payee name</option>
              <option value="vpa">UPI VPA</option>
              <option value="ref_number">Reference no.</option>
              <option value="channel">Channel</option>
            </Select>
          </Field>
          <Field label="Match">
            <Select
              value={form.match_type}
              onChange={(e) => setForm({ ...form, match_type: e.target.value })}
            >
              <option value="contains">contains</option>
              <option value="exact">equals</option>
              <option value="prefix">starts with</option>
              <option value="regex">regex</option>
            </Select>
          </Field>
          <Field label="Pattern">
            <Input
              value={form.pattern}
              onChange={(e) => setForm({ ...form, pattern: e.target.value })}
              placeholder="e.g. ZOLOSTAYS"
              className="w-52"
            />
          </Field>
          <Field label="Direction">
            <Select
              value={form.direction}
              onChange={(e) =>
                setForm({ ...form, direction: e.target.value as typeof form.direction })
              }
            >
              <option value="">Both</option>
              <option value="debit">Debit</option>
              <option value="credit">Credit</option>
            </Select>
          </Field>
          <Field label="→ Category">
            <Select
              value={form.category_id || ""}
              onChange={(e) => setForm({ ...form, category_id: Number(e.target.value) })}
            >
              <option value="">Choose…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Priority">
            <Input
              type="number"
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
              className="w-20"
            />
          </Field>
          <Button
            variant="ghost"
            disabled={pending || !form.pattern || !form.category_id}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const res = await testRuleAction(payload());
                if (!res.ok) setError(res.error ?? "Test failed.");
                else setTest({ total: res.total, matches: res.matches });
              })
            }
          >
            Test against history
          </Button>
          <Button
            disabled={pending || !form.pattern || !form.category_id}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const res = await createRuleAction(payload());
                if (!res.ok) setError(res.error ?? "Failed.");
                else {
                  setForm({ ...form, pattern: "" });
                  setTest(null);
                  router.refresh();
                }
              })
            }
          >
            Add rule
          </Button>
        </div>
        {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
        {test ? (
          <div className="mt-3 rounded-lg border border-hairline p-2 text-xs">
            <p className="mb-1 font-medium">
              Would match <span className="tnum">{test.total}</span> existing transaction(s)
              {test.total > test.matches.length ? ` (showing ${test.matches.length})` : ""}:
            </p>
            <ul className="max-h-40 space-y-0.5 overflow-y-auto">
              {test.matches.map((m) => (
                <li key={m.id} className="flex justify-between gap-3">
                  <span className="truncate text-ink-secondary">
                    {m.txn_date} · {m.narration}
                  </span>
                  <span className="tnum">{formatPaise(m.amount_paise)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      <Table>
        <thead>
          <tr>
            <Th className="text-right">Priority</Th>
            <Th>Condition</Th>
            <Th>Category</Th>
            <Th className="text-right">Hits</Th>
            <Th>Status</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.id} className={r.is_active ? "" : "opacity-50"}>
              <Td className="text-right tnum">
                {r.priority}
                {r.priority >= 900 ? (
                  <span className="ml-1">
                    <Badge tone="warning">seed</Badge>
                  </span>
                ) : null}
              </Td>
              <Td className="max-w-72 truncate text-xs">
                <code>
                  {r.field} {r.match_type} “{r.pattern}”
                </code>
                {r.direction ? <span className="text-ink-muted"> · {r.direction}s only</span> : null}
              </Td>
              <Td className="font-medium">{r.category_name}</Td>
              <Td className="text-right tnum">{r.hit_count}</Td>
              <Td>
                <button
                  className="text-xs text-accent hover:underline"
                  onClick={() =>
                    startTransition(async () => {
                      await toggleRuleAction(r.id, r.is_active !== 1);
                      router.refresh();
                    })
                  }
                >
                  {r.is_active === 1 ? "active" : "inactive"}
                </button>
              </Td>
              <Td>
                <button
                  className="text-xs text-danger hover:underline"
                  onClick={() =>
                    startTransition(async () => {
                      await deleteRuleAction(r.id);
                      router.refresh();
                    })
                  }
                >
                  delete
                </button>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
      {label}
      {children}
    </label>
  );
}
