"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { stageBatchAction } from "@/lib/actions/import";
import { createAccountAction } from "@/lib/actions/accounts";
import { Button, Card, CardTitle, Input, Select, cx } from "@/components/ui";
import type { AccountRow, ImportPresetRow } from "@/lib/db/types";

/**
 * Interactive region/header mapping. The user clicks the header row on the
 * preview grid, assigns canonical fields per column, binds an account, and
 * optionally saves the whole thing as a reusable preset (auto-matched by
 * header fingerprint on the next import).
 */

const BANK_FIELD_OPTIONS = [
  ["", "—"],
  ["date", "Date"],
  ["narration", "Narration / Description"],
  ["ref_number", "Reference no."],
  ["value_date", "Value date"],
  ["debit", "Debit / Withdrawal"],
  ["credit", "Credit / Deposit"],
  ["amount", "Amount (single column)"],
  ["drcr", "Dr/Cr flag"],
  ["balance", "Balance"],
] as const;

const MF_FIELD_OPTIONS = [
  ["", "—"],
  ["order_no", "Order no."],
  ["order_date", "Order date"],
  ["isin", "ISIN"],
  ["scheme_name", "Scheme name"],
  ["folio", "Folio"],
  ["side", "Buy/Sell"],
  ["units", "Units"],
  ["nav", "NAV"],
  ["amount", "Amount"],
] as const;

interface Detection {
  headerRow: number;
  dataStartRow: number;
  columnMap: Record<string, number>;
  fingerprint: string;
}

export function MappingWizard({
  batchId,
  preview,
  detection,
  matchedPreset,
  accounts,
  presets,
}: {
  batchId: number;
  preview: string[][];
  detection: Detection | null;
  matchedPreset: { id: number; name: string; account_id: number | null } | null;
  accounts: AccountRow[];
  presets: ImportPresetRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const preset = matchedPreset ? presets.find((p) => p.id === matchedPreset.id) : undefined;

  const [headerRow, setHeaderRow] = useState<number | null>(detection?.headerRow ?? null);
  const [dataStartRow, setDataStartRow] = useState<number>(detection?.dataStartRow ?? 0);
  const [statementKind, setStatementKind] = useState<string>(preset?.statement_kind ?? "bank");
  const [columnMap, setColumnMap] = useState<Record<string, number>>(
    preset ? (JSON.parse(preset.column_map) as Record<string, number>) : detection?.columnMap ?? {},
  );
  const [amountStyle, setAmountStyle] = useState<string>(
    preset?.amount_style ?? inferAmountStyle(detection?.columnMap ?? {}),
  );
  const [narrationPlugin, setNarrationPlugin] = useState<string>(
    preset?.narration_plugin ?? "generic",
  );
  const [accountId, setAccountId] = useState<number | "new" | "">(
    matchedPreset?.account_id ?? (accounts.length === 1 ? accounts[0].id : ""),
  );
  const [savePresetName, setSavePresetName] = useState("");
  const [newAccount, setNewAccount] = useState({ name: "", type: "bank", institution: "" });

  const columnCount = useMemo(
    () => Math.max(0, ...preview.map((r) => r.length)),
    [preview],
  );
  const fieldOptions = statementKind === "mf_orders" ? MF_FIELD_OPTIONS : BANK_FIELD_OPTIONS;
  const usingPreset = Boolean(preset);

  function fieldForColumn(col: number): string {
    return Object.entries(columnMap).find(([, idx]) => idx === col)?.[0] ?? "";
  }

  function setFieldForColumn(col: number, field: string) {
    setColumnMap((prev) => {
      const next = { ...prev };
      for (const [f, idx] of Object.entries(next)) if (idx === col) delete next[f];
      if (field) {
        // A field can only map to one column.
        delete next[field];
        next[field] = col;
      }
      return next;
    });
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      let finalAccountId = accountId;
      if (accountId === "new") {
        const res = await createAccountAction({
          name: newAccount.name,
          type: newAccount.type,
          institution: newAccount.institution,
        });
        if (!res.ok) {
          setError(res.error ?? "Could not create the account.");
          return;
        }
        finalAccountId = res.id;
      }
      if (!finalAccountId || finalAccountId === "new") {
        setError("Pick or create an account for this statement.");
        return;
      }
      const res = await stageBatchAction({
        batchId,
        accountId: finalAccountId,
        statementKind,
        headerRow,
        dataStartRow,
        columnMap,
        amountStyle,
        narrationPlugin: narrationPlugin || null,
        presetId: preset?.id ?? null,
        savePresetName: savePresetName || null,
      });
      if (!res.ok) {
        setError(res.error ?? "Parsing failed.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {matchedPreset ? (
        <div className="rounded-lg bg-success-bg px-3 py-2 text-sm text-success">
          Matched saved preset <strong>{matchedPreset.name}</strong> — mapping pre-filled. Pick the
          account and continue.
        </div>
      ) : detection ? (
        <div className="rounded-lg bg-info-bg px-3 py-2 text-sm text-info">
          Headers auto-detected on row {detection.headerRow + 1}. Adjust anything below, then
          continue.
        </div>
      ) : (
        <div className="rounded-lg bg-warning-bg px-3 py-2 text-sm text-warning">
          Could not auto-detect a header row — click the header row in the preview and map the
          columns manually.
        </div>
      )}

      <Card>
        <CardTitle>Preview — click a row to mark it as the header</CardTitle>
        <div className="max-h-80 overflow-auto rounded-lg border border-hairline">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className="sticky top-0 bg-surface px-1 py-1 text-ink-muted">#</th>
                {Array.from({ length: columnCount }, (_, c) => (
                  <th key={c} className="sticky top-0 min-w-28 bg-surface px-1 py-1">
                    <Select
                      value={fieldForColumn(c)}
                      onChange={(e) => setFieldForColumn(c, e.target.value)}
                      className="w-full px-1 py-0.5 text-[11px]"
                    >
                      {fieldOptions.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.map((row, r) => (
                <tr
                  key={r}
                  onClick={() => {
                    setHeaderRow(r);
                    setDataStartRow(r + 1);
                  }}
                  className={cx(
                    "cursor-pointer",
                    r === headerRow
                      ? "bg-accent/15 font-semibold"
                      : r === dataStartRow
                        ? "bg-success-bg/60"
                        : r > (headerRow ?? -1) && "hover:bg-hairline/30",
                  )}
                >
                  <td className="px-1 py-0.5 text-ink-muted">{r + 1}</td>
                  {Array.from({ length: columnCount }, (_, c) => (
                    <td key={c} className="max-w-52 truncate border-b border-hairline/40 px-1.5 py-0.5">
                      {row[c] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-ink-muted">
          Header row: {headerRow !== null ? headerRow + 1 : "—"} · data starts row {dataStartRow + 1}{" "}
          (highlighted green)
        </p>
      </Card>

      <Card>
        <CardTitle>Statement details</CardTitle>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
            Statement type
            <Select value={statementKind} onChange={(e) => setStatementKind(e.target.value)}>
              <option value="bank">Bank account</option>
              <option value="credit_card">Credit card</option>
              <option value="mf_orders">Mutual fund orders</option>
            </Select>
          </label>
          {statementKind !== "mf_orders" ? (
            <>
              <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
                Amount style
                <Select value={amountStyle} onChange={(e) => setAmountStyle(e.target.value)}>
                  <option value="debit_credit_columns">Separate debit / credit columns</option>
                  <option value="amount_with_drcr_flag">Amount + Dr/Cr flag</option>
                  <option value="signed_amount">Signed amount (− = debit)</option>
                </Select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
                Narration format
                <Select value={narrationPlugin} onChange={(e) => setNarrationPlugin(e.target.value)}>
                  <option value="generic">Generic (any bank)</option>
                  <option value="hdfc">HDFC Bank</option>
                </Select>
              </label>
            </>
          ) : null}
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
            Account
            <Select
              value={String(accountId)}
              onChange={(e) =>
                setAccountId(e.target.value === "new" ? "new" : Number(e.target.value) || "")
              }
            >
              <option value="">Choose…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
              <option value="new">+ New account</option>
            </Select>
          </label>
          {!usingPreset ? (
            <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary md:col-span-2">
              Save as preset (optional — auto-applied to future files with these headers)
              <Input
                value={savePresetName}
                onChange={(e) => setSavePresetName(e.target.value)}
                placeholder='e.g. "ICICI savings xlsx"'
              />
            </label>
          ) : null}
        </div>

        {accountId === "new" ? (
          <div className="mt-3 grid grid-cols-3 gap-3 rounded-lg border border-hairline p-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
              Account name
              <Input
                value={newAccount.name}
                onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })}
                placeholder="HDFC Savings"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
              Type
              <Select
                value={newAccount.type}
                onChange={(e) => setNewAccount({ ...newAccount, type: e.target.value })}
              >
                <option value="bank">Bank</option>
                <option value="credit_card">Credit card</option>
                <option value="investment">Investment</option>
                <option value="cash">Cash</option>
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
              Institution
              <Input
                value={newAccount.institution}
                onChange={(e) => setNewAccount({ ...newAccount, institution: e.target.value })}
                placeholder="HDFC Bank"
              />
            </label>
          </div>
        ) : null}

        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
        <div className="mt-4 flex justify-end">
          <Button onClick={submit} disabled={pending}>
            {pending ? "Parsing…" : "Parse & review →"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function inferAmountStyle(columnMap: Record<string, number>): string {
  if ("debit" in columnMap || "credit" in columnMap) return "debit_credit_columns";
  if ("drcr" in columnMap) return "amount_with_drcr_flag";
  return "signed_amount";
}
