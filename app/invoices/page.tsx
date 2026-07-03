import { Suspense } from "react";
import { connection } from "next/server";
import { db } from "@/lib/db/client";
import type { InvoiceRow } from "@/lib/db/types";
import { formatPaise } from "@/lib/domain/money";
import { Badge, Card, CardTitle, EmptyState, Table, Th, Td, type BadgeTone } from "@/components/ui";
import { InvoiceForm, PaidMatcher } from "@/components/invoices/invoices-client";

const STATUS_TONE: Record<string, BadgeTone> = {
  draft: "neutral",
  sent: "warning",
  paid: "success",
  void: "neutral",
};

export default function InvoicesPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Invoices</h1>
        <p className="text-sm text-ink-secondary">
          Freelance/consulting invoices — sent ones are auto-matched against incoming bank credits
          of the same amount.
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
  const conn = db();
  const invoices = conn
    .prepare(`SELECT * FROM invoices ORDER BY issue_date DESC, id DESC`)
    .all() as InvoiceRow[];

  // Suggest matching credits for unpaid invoices: same paise amount, on/after
  // issue date, not already matched to another invoice.
  const matchStmt = conn.prepare(
    `SELECT t.id, t.txn_date, t.narration, t.amount_paise
     FROM transactions t
     WHERE t.direction = 'credit' AND t.amount_paise = ? AND t.txn_date >= ?
       AND t.id NOT IN (SELECT paid_txn_id FROM invoices WHERE paid_txn_id IS NOT NULL)
     ORDER BY t.txn_date LIMIT 3`,
  );

  const nextNumber = suggestNextNumber(invoices);

  return (
    <>
      <InvoiceForm nextNumber={nextNumber} />
      {invoices.length === 0 ? (
        <EmptyState title="No invoices yet" hint="Raise your first invoice above." />
      ) : (
        <Card>
          <CardTitle>Register</CardTitle>
          <Table className="border-0">
            <thead>
              <tr>
                <Th>Invoice</Th>
                <Th>Client</Th>
                <Th>Date</Th>
                <Th className="text-right">Amount</Th>
                <Th className="text-right">INR</Th>
                <Th>Status</Th>
                <Th>Payment</Th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => {
                const candidates =
                  inv.status === "sent"
                    ? (matchStmt.all(inv.amount_inr_paise, inv.issue_date) as Array<{
                        id: number;
                        txn_date: string;
                        narration: string;
                        amount_paise: number;
                      }>)
                    : [];
                return (
                  <tr key={inv.id} className={inv.status === "void" ? "opacity-50" : ""}>
                    <Td className="font-medium">{inv.invoice_no}</Td>
                    <Td>{inv.client}</Td>
                    <Td className="tnum">{inv.issue_date}</Td>
                    <Td className="text-right tnum">
                      {inv.currency !== "INR" ? `${inv.currency} ` : ""}
                      {(inv.amount_minor / 100).toLocaleString("en-IN")}
                    </Td>
                    <Td className="text-right tnum font-medium">
                      {formatPaise(inv.amount_inr_paise)}
                    </Td>
                    <Td>
                      <Badge tone={STATUS_TONE[inv.status]}>{inv.status}</Badge>
                    </Td>
                    <Td>
                      {inv.status === "sent" ? (
                        <PaidMatcher invoiceId={inv.id} candidates={candidates} />
                      ) : inv.status === "paid" && inv.paid_txn_id ? (
                        <span className="text-xs text-success">matched txn #{inv.paid_txn_id}</span>
                      ) : null}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}

/** MVS2025001INV → MVS2025002INV; otherwise a simple year-seq suggestion. */
function suggestNextNumber(invoices: InvoiceRow[]): string {
  const year = String(new Date().getFullYear());
  const latest = invoices.find((i) => i.invoice_no.includes(year));
  if (latest) {
    const m = latest.invoice_no.match(/^(.*?)(\d{3,})(\D*)$/);
    if (m) {
      const next = String(Number(m[2]) + 1).padStart(m[2].length, "0");
      return `${m[1]}${next}${m[3]}`;
    }
  }
  return `INV${year}001`;
}
