import "server-only";
import ExcelJS from "exceljs";
import { db } from "@/lib/db/client";
import { fyLabel } from "@/lib/domain/fy";
import { fyStartMonth } from "@/lib/repos/settings";

/**
 * Investment transactions export for audit/CA use: a flat, filterable
 * Transactions sheet (running unit balance, ISIN/folio identity, linked bank
 * debit for traceability) plus a per-instrument Summary sheet (opening →
 * bought/sold/dividends → closing for the period). Scoped to one FY or the
 * full history.
 */

const TYPE_LABEL: Record<string, string> = {
  sip: "Buy (SIP)",
  lumpsum: "Buy",
  sell: "Sell",
  dividend: "Dividend",
};

const KIND_LABEL: Record<string, string> = {
  mutual_fund: "MF",
  stock: "Stock",
  etf: "ETF",
  ppf: "PPF",
  epf: "EPF",
  nps: "NPS",
  bond: "Bond",
  other: "Other",
};

interface TxnRow {
  fund_id: number;
  txn_date: string;
  txn_type: string;
  amount_paise: number;
  nav: number | null;
  units: number | null;
  order_no: string | null;
  fy_start_year: number;
  name: string;
  instrument_kind: string;
  isin: string | null;
  folio: string | null;
  bank_date: string | null;
  bank_account: string | null;
}

/** fy = fy_start_year to scope to one financial year; null = all history. */
export async function buildInvestmentsSheet(fy: number | null): Promise<{
  buffer: Buffer;
  fileName: string;
}> {
  const conn = db();
  const startMonth = fyStartMonth();

  const all = conn
    .prepare(
      `SELECT t.fund_id, t.txn_date, t.txn_type, t.amount_paise, t.nav, t.units,
              t.order_no, t.fy_start_year,
              f.name, f.instrument_kind, f.isin, f.folio,
              bt.txn_date AS bank_date, ba.name AS bank_account
       FROM investment_txns t
       JOIN funds f ON f.id = t.fund_id
       LEFT JOIN transactions bt ON bt.id = t.linked_txn_id
       LEFT JOIN accounts ba ON ba.id = bt.account_id
       ORDER BY t.txn_date, f.name, t.id`,
    )
    .all() as TxnRow[];

  // Running unit balance walks the FULL history per instrument, so an
  // FY-scoped sheet still shows true balances (and the summary gets its
  // opening position for free).
  const signedUnits = (t: TxnRow) =>
    t.units === null ? 0 : t.txn_type === "sell" ? -t.units : t.txn_type === "dividend" ? 0 : t.units;
  const running = new Map<number, number>();
  const inScope: Array<TxnRow & { balance: number }> = [];
  const opening = new Map<number, number>(); // units held entering the scoped FY
  for (const t of all) {
    const bal = (running.get(t.fund_id) ?? 0) + signedUnits(t);
    running.set(t.fund_id, bal);
    if (fy !== null && t.fy_start_year < fy) opening.set(t.fund_id, bal);
    if (fy === null || t.fy_start_year === fy) inScope.push({ ...t, balance: bal });
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Transactions", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.addTable({
    name: "InvestmentTransactions",
    ref: "A1",
    headerRow: true,
    style: { theme: "TableStyleMedium2", showRowStripes: true },
    columns: [
      { name: "Date", filterButton: true },
      { name: "Instrument", filterButton: true },
      { name: "Kind", filterButton: true },
      { name: "ISIN", filterButton: true },
      { name: "Folio", filterButton: true },
      { name: "Type", filterButton: true },
      { name: "Amount (Rs)", filterButton: true },
      { name: "NAV/Price", filterButton: true },
      { name: "Units", filterButton: true },
      { name: "Unit Balance", filterButton: true },
      { name: "Order No", filterButton: true },
      { name: "FY", filterButton: true },
      { name: "Bank Ref", filterButton: true },
    ],
    rows: inScope.length
      ? inScope.map((t) => [
          new Date(`${t.txn_date}T00:00:00Z`),
          t.name,
          KIND_LABEL[t.instrument_kind] ?? t.instrument_kind,
          t.isin,
          t.folio,
          TYPE_LABEL[t.txn_type] ?? t.txn_type,
          t.amount_paise / 100,
          t.nav,
          t.units,
          t.units === null && t.txn_type === "dividend" ? null : round4(t.balance),
          t.order_no,
          fyLabel(t.fy_start_year, startMonth),
          t.bank_account ? `${t.bank_account} ${t.bank_date}` : null,
        ])
      : [Array(13).fill(null)],
  });
  ws.getColumn(1).numFmt = "dd-mm-yyyy";
  ws.getColumn(7).numFmt = "#,##0.00";
  ws.getColumn(8).numFmt = "#,##0.0000";
  for (const c of [9, 10]) ws.getColumn(c).numFmt = "#,##0.000";
  ws.getColumn(2).width = 45;
  for (const c of [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]) ws.getColumn(c).width = 15;

  // ---- Summary sheet: per-instrument rollup for the period -----------------
  const byFund = new Map<number, (typeof inScope)[number][]>();
  for (const t of inScope) {
    (byFund.get(t.fund_id) ?? byFund.set(t.fund_id, []).get(t.fund_id)!).push(t);
  }
  const summary = [...byFund.values()].map((txns) => {
    const f = txns[0];
    const sum = (pred: (t: TxnRow) => boolean, sel: (t: TxnRow) => number) =>
      txns.filter(pred).reduce((s, t) => s + sel(t), 0);
    const open = opening.get(f.fund_id) ?? 0;
    return {
      name: f.name,
      kind: KIND_LABEL[f.instrument_kind] ?? f.instrument_kind,
      isin: f.isin,
      folio: f.folio,
      opening_units: round4(open),
      bought_units: round4(sum((t) => t.txn_type !== "sell" && t.txn_type !== "dividend", (t) => t.units ?? 0)),
      invested: sum((t) => t.txn_type === "sip" || t.txn_type === "lumpsum", (t) => t.amount_paise) / 100,
      sold_units: round4(sum((t) => t.txn_type === "sell", (t) => t.units ?? 0)),
      redeemed: sum((t) => t.txn_type === "sell", (t) => t.amount_paise) / 100,
      dividends: sum((t) => t.txn_type === "dividend", (t) => t.amount_paise) / 100,
      closing_units: round4(txns[txns.length - 1].balance),
    };
  });

  const ss = wb.addWorksheet("Summary", { views: [{ state: "frozen", ySplit: 1 }] });
  ss.addTable({
    name: "InvestmentSummary",
    ref: "A1",
    headerRow: true,
    style: { theme: "TableStyleMedium2", showRowStripes: true },
    columns: [
      { name: "Instrument", filterButton: true },
      { name: "Kind", filterButton: true },
      { name: "ISIN", filterButton: true },
      { name: "Folio", filterButton: true },
      { name: "Opening Units", filterButton: true },
      { name: "Units Bought", filterButton: true },
      { name: "Invested (Rs)", filterButton: true },
      { name: "Units Sold", filterButton: true },
      { name: "Redeemed (Rs)", filterButton: true },
      { name: "Dividends (Rs)", filterButton: true },
      { name: "Closing Units", filterButton: true },
    ],
    rows: summary.length
      ? summary.map((s) => [
          s.name, s.kind, s.isin, s.folio, s.opening_units, s.bought_units,
          s.invested, s.sold_units, s.redeemed, s.dividends, s.closing_units,
        ])
      : [Array(11).fill(null)],
  });
  for (const c of [5, 6, 8, 11]) ss.getColumn(c).numFmt = "#,##0.000";
  for (const c of [7, 9, 10]) ss.getColumn(c).numFmt = "#,##0.00";
  ss.getColumn(1).width = 45;
  for (const c of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) ss.getColumn(c).width = 15;

  const scope = fy !== null ? fyLabel(fy, startMonth) : "all-time";
  return {
    buffer: Buffer.from(await wb.xlsx.writeBuffer()),
    fileName: `investment-transactions-${scope}.xlsx`,
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
