"use client";

import { useState, useTransition } from "react";
import {
  bootstrapInvestmentsAction,
  bootstrapMastersheetAction,
} from "@/lib/actions/bootstrap";
import { Button, Card, CardTitle, Input, Select } from "@/components/ui";
import type { AccountRow } from "@/lib/db/types";

export function BootstrapForms({ accounts }: { accounts: AccountRow[] }) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <Card>
      <CardTitle>Migrate from Excel (one-time)</CardTitle>
      <p className="mb-3 text-sm text-ink-secondary">
        Already tracking finances in workbooks? Import them once — categories, a year of manual
        tagging (which pre-trains auto-categorization), and your investment log all carry over.
      </p>

      <div className="space-y-4">
        <form
          action={(fd) =>
            startTransition(async () => {
              const res = await bootstrapMastersheetAction(fd);
              setMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
            })
          }
          className="flex flex-wrap items-end gap-2 rounded-lg border border-hairline p-3"
        >
          <div className="w-full text-xs font-semibold text-ink">
            FY mastersheet (Setup / Party_Master / month tabs)
          </div>
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
            Workbook
            <input type="file" name="file" accept=".xlsx,.xls" required className="text-xs" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
            Into account
            <Select name="account_id" required defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
            Password (if any)
            <Input type="password" name="password" className="w-32" />
          </label>
          <Button type="submit" disabled={pending}>
            {pending ? "Importing…" : "Import mastersheet"}
          </Button>
        </form>

        <form
          action={(fd) =>
            startTransition(async () => {
              const res = await bootstrapInvestmentsAction(fd);
              setMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
            })
          }
          className="flex flex-wrap items-end gap-2 rounded-lg border border-hairline p-3"
        >
          <div className="w-full text-xs font-semibold text-ink">
            Investments workbook (Fund_Master / Investment_Log / Party_Allocator)
          </div>
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
            Workbook
            <input type="file" name="file" accept=".xlsx,.xls" required className="text-xs" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
            Password (if any)
            <Input type="password" name="password" className="w-32" />
          </label>
          <Button type="submit" disabled={pending}>
            {pending ? "Importing…" : "Import investments"}
          </Button>
        </form>
      </div>

      {msg ? (
        <p className={`mt-3 text-sm ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</p>
      ) : null}
    </Card>
  );
}
