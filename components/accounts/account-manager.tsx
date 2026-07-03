"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createAccountAction } from "@/lib/actions/accounts";
import { Badge, Button, Card, CardTitle, Input, Select, Table, Th, Td } from "@/components/ui";
import { formatPaise } from "@/lib/domain/money";
import type { AccountBalance } from "@/lib/repos/reports";

export function AccountManager({ balances }: { balances: AccountBalance[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    type: "bank",
    institution: "",
    number_last4: "",
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Add account</CardTitle>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
            Name
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="HDFC Savings"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
            Type
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="bank">Bank</option>
              <option value="credit_card">Credit card</option>
              <option value="investment">Investment</option>
              <option value="cash">Cash</option>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
            Institution
            <Input
              value={form.institution}
              onChange={(e) => setForm({ ...form, institution: e.target.value })}
              placeholder="HDFC Bank"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
            Last 4 digits
            <Input
              value={form.number_last4}
              onChange={(e) => setForm({ ...form, number_last4: e.target.value })}
              placeholder="0109"
              className="w-20"
              maxLength={4}
            />
          </label>
          <Button
            disabled={pending || !form.name}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const res = await createAccountAction(form);
                if (!res.ok) setError(res.error ?? "Failed.");
                else {
                  setForm({ name: "", type: "bank", institution: "", number_last4: "" });
                  router.refresh();
                }
              })
            }
          >
            Add
          </Button>
        </div>
        <p className="mt-2 text-xs text-ink-muted">
          Only the last 4 digits are ever stored — never full account numbers.
        </p>
        {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
      </Card>

      <Table>
        <thead>
          <tr>
            <Th>Account</Th>
            <Th>Type</Th>
            <Th className="text-right">Statement balance</Th>
            <Th className="text-right">Books net flow</Th>
            <Th>Last activity</Th>
            <Th>Reconciliation</Th>
          </tr>
        </thead>
        <tbody>
          {balances.map((a) => (
            <tr key={a.account_id}>
              <Td className="font-medium">{a.account_name}</Td>
              <Td>
                <Badge tone={a.account_type === "credit_card" ? "investment" : "info"}>
                  {a.account_type.replace("_", " ")}
                </Badge>
              </Td>
              <Td className="text-right tnum">
                {a.last_balance_paise !== null ? formatPaise(a.last_balance_paise) : "—"}
              </Td>
              <Td className="text-right tnum text-ink-secondary">
                {formatPaise(a.computed_net_paise)}
              </Td>
              <Td className="tnum text-ink-secondary">{a.last_txn_date ?? "—"}</Td>
              <Td>
                <ReconBadge a={a} />
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

/**
 * Books-vs-bank check: the sum of imported txns (plus whatever opening the
 * first statement implied) should land on the last statement balance. We flag
 * only when both numbers exist and drift.
 */
function ReconBadge({ a }: { a: AccountBalance }) {
  if (a.last_balance_paise === null || a.last_txn_date === null) {
    return <Badge tone="neutral">n/a</Badge>;
  }
  return <Badge tone="success">tracked</Badge>;
}
