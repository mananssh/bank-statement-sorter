import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { db } from "@/lib/db/client";
import { FileDrop } from "@/components/import/file-drop";
import { Card, CardTitle, Badge, Table, Th, Td, EmptyState } from "@/components/ui";
import { formatPaise } from "@/lib/domain/money";

export default function ImportPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-lg font-semibold">Import a statement</h1>
      <FileDrop />
      <Suspense>
        <RecentActivity />
      </Suspense>
    </div>
  );
}

async function RecentActivity() {
  await connection();
  const conn = db();
  const openBatches = conn
    .prepare(
      `SELECT id, file_name, created_at FROM import_batches
       WHERE status = 'staging' ORDER BY created_at DESC LIMIT 10`,
    )
    .all() as Array<{ id: number; file_name: string; created_at: string }>;
  const statements = conn
    .prepare(
      `SELECT s.id, s.file_name, s.period_start, s.period_end, s.rows_imported,
              s.rows_duplicate, s.imported_at, a.name AS account_name,
              (SELECT COALESCE(SUM(t.amount_paise), 0) FROM transactions t
               WHERE t.statement_id = s.id AND t.direction = 'debit') AS debits
       FROM statements s JOIN accounts a ON a.id = s.account_id
       ORDER BY s.imported_at DESC LIMIT 15`,
    )
    .all() as Array<{
    id: number;
    file_name: string;
    period_start: string | null;
    period_end: string | null;
    rows_imported: number;
    rows_duplicate: number;
    imported_at: string;
    account_name: string;
    debits: number;
  }>;

  return (
    <>
      {openBatches.length > 0 ? (
        <Card>
          <CardTitle>In progress</CardTitle>
          <ul className="space-y-1">
            {openBatches.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/import/${b.id}`}
                  className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-hairline/40"
                >
                  <span className="font-medium text-accent">{b.file_name}</span>
                  <span className="text-xs text-ink-muted">resume →</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardTitle>Imported statements</CardTitle>
        {statements.length === 0 ? (
          <EmptyState
            title="Nothing imported yet"
            hint="Drop your first bank or card statement above to get started."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>File</Th>
                <Th>Account</Th>
                <Th>Period</Th>
                <Th className="text-right">Rows</Th>
                <Th className="text-right">Debits</Th>
              </tr>
            </thead>
            <tbody>
              {statements.map((s) => (
                <tr key={s.id}>
                  <Td className="max-w-56 truncate font-medium">{s.file_name}</Td>
                  <Td>{s.account_name}</Td>
                  <Td className="whitespace-nowrap text-ink-secondary">
                    {s.period_start} → {s.period_end}
                  </Td>
                  <Td className="text-right tnum">
                    {s.rows_imported}
                    {s.rows_duplicate > 0 ? (
                      <span className="ml-1.5">
                        <Badge tone="neutral">{s.rows_duplicate} dup</Badge>
                      </span>
                    ) : null}
                  </Td>
                  <Td className="text-right tnum text-debit">{formatPaise(s.debits)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
