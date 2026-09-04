import "server-only";
import ExcelJS from "exceljs";
import { db } from "@/lib/db/client";
import { fyDateRange, fyLabel } from "@/lib/domain/fy";
import { fyStartMonth } from "@/lib/repos/settings";
import { categoryRollup, kpiSummary, monthlyRollup } from "@/lib/repos/reports";
import { listFixedDeposits, listHoldings } from "@/lib/repos/investments";
import { goalAttribution } from "@/lib/repos/goals";

/**
 * The clean FY workbook: one file per financial year, every sheet a proper
 * Excel table (header row 1, autofilter, typed dates, frozen header, computed
 * values — no formulas). Pivot/Power-Query ready by construction. This
 * intentionally does NOT reproduce the legacy mastersheet layout.
 */

const MONEY_FMT = "#,##0.00";

function isoToDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export async function buildFyWorkbook(fyStartYear: number): Promise<Buffer> {
  const conn = db();
  const startMonth = fyStartMonth();
  const label = fyLabel(fyStartYear, startMonth);
  const { from, to } = fyDateRange(fyStartYear, startMonth);

  const wb = new ExcelJS.Workbook();
  wb.creator = "statement-sorter";
  wb.created = new Date();

  // --- Summary ---------------------------------------------------------------
  const kpi = kpiSummary(from, to);
  const monthly = monthlyRollup(from, to);
  const byCategory = categoryRollup(from, to);

  const summary = wb.addWorksheet("Summary");
  summary.getCell("A1").value = `${label} — Summary`;
  summary.getCell("A1").font = { bold: true, size: 14 };
  const kpiRows: Array<[string, number | string]> = [
    ["Income", kpi.income_paise / 100],
    ["Expenses", kpi.expense_paise / 100],
    ["Investments", kpi.investment_paise / 100],
    ["Net Flow", kpi.net_flow_paise / 100],
    ["Savings Rate", kpi.savings_rate !== null ? `${Math.round(kpi.savings_rate * 100)}%` : "—"],
    ["Transactions", kpi.txn_count],
    ["Untagged", kpi.untagged_count],
  ];
  kpiRows.forEach(([k, v], i) => {
    summary.getCell(`A${3 + i}`).value = k;
    summary.getCell(`B${3 + i}`).value = v;
    if (typeof v === "number" && i < 4) summary.getCell(`B${3 + i}`).numFmt = MONEY_FMT;
  });

  if (monthly.length) {
    summary.addTable({
      name: "MonthlyRollup",
      ref: "A12",
      headerRow: true,
      style: { theme: "TableStyleMedium2", showRowStripes: true },
      columns: [
        { name: "Month" },
        { name: "Income" },
        { name: "Expenses" },
        { name: "Investments" },
        { name: "Net Flow" },
        { name: "Savings Rate %" },
      ],
      rows: monthly.map((m) => [
        m.month,
        m.credits_paise / 100,
        m.debits_paise / 100,
        m.investments_paise / 100,
        m.net_flow_paise / 100,
        m.savings_rate !== null ? Math.round(m.savings_rate * 100) : null,
      ]),
    });
  }
  if (byCategory.length) {
    const startRow = 14 + monthly.length + 2;
    summary.addTable({
      name: "CategoryRollup",
      ref: `A${startRow}`,
      headerRow: true,
      style: { theme: "TableStyleMedium2", showRowStripes: true },
      columns: [
        { name: "Category" },
        { name: "Type" },
        { name: "Total" },
        { name: "% of Expense" },
        { name: "Txn Count" },
        { name: "Avg" },
        { name: "Largest" },
        { name: "Last Date" },
      ],
      rows: byCategory.map((c) => [
        c.category_name,
        c.category_type,
        c.total_paise / 100,
        c.pct_of_expense !== null ? Math.round(c.pct_of_expense * 1000) / 10 : null,
        c.txn_count,
        c.avg_paise / 100,
        c.largest_paise / 100,
        c.last_date,
      ]),
    });
  }
  summary.getColumn(1).width = 28;
  for (let c = 2; c <= 8; c++) summary.getColumn(c).width = 14;

  // --- Transactions ------------------------------------------------------------
  const txns = conn
    .prepare(
      `SELECT t.*, a.name AS account_name, c.name AS category_name, c.type AS category_type,
              p.canonical_name AS party_name
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN parties p ON p.id = t.party_id
       WHERE t.fy_start_year = ?
       ORDER BY t.txn_date, t.id`,
    )
    .all(fyStartYear) as Array<Record<string, unknown>>;

  addTableSheet(wb, "Transactions", [
    "Txn_ID", "Date", "Account", "Narration", "Ref", "Debit", "Credit", "Balance",
    "Channel", "Party", "Category", "Type", "Description", "UPI_Note", "Month", "FY",
  ], txns.map((t, i) => [
    `${label.replace("FY", "FY")}-${String(i + 1).padStart(4, "0")}`,
    isoToDate(t.txn_date as string),
    t.account_name,
    t.narration,
    t.ref_number,
    t.direction === "debit" ? (t.amount_paise as number) / 100 : null,
    t.direction === "credit" ? (t.amount_paise as number) / 100 : null,
    t.balance_paise !== null ? (t.balance_paise as number) / 100 : null,
    t.channel,
    t.party_name,
    t.category_name,
    t.category_type,
    t.description,
    t.upi_note,
    t.month,
    label,
  ]), { dateCols: [2], moneyCols: [6, 7, 8], widths: { 4: 60 } });

  // --- Taxonomy ---------------------------------------------------------------
  const categories = conn
    .prepare(`SELECT name, type, is_active, notes FROM categories ORDER BY sort_order, name`)
    .all() as Array<Record<string, unknown>>;
  addTableSheet(wb, "Categories", ["Name", "Type", "Active", "Notes"],
    categories.map((c) => [c.name, c.type, c.is_active ? "Yes" : "No", c.notes]));

  const parties = conn
    .prepare(
      `SELECT p.canonical_name,
              (SELECT c.name FROM categories c WHERE c.id = p.default_category_id) AS default_category,
              (SELECT GROUP_CONCAT(alias_key, ', ') FROM party_aliases a WHERE a.party_id = p.id) AS aliases,
              (SELECT COUNT(*) FROM transactions t WHERE t.party_id = p.id) AS txn_count
       FROM parties p ORDER BY p.canonical_name`,
    )
    .all() as Array<Record<string, unknown>>;
  addTableSheet(wb, "Parties", ["Party", "Default Category", "Aliases", "Txn Count"],
    parties.map((p) => [p.canonical_name, p.default_category, p.aliases, p.txn_count]));

  // --- Investments -------------------------------------------------------------
  const invTxns = conn
    .prepare(
      `SELECT t.txn_date, f.name AS fund, t.txn_type, t.amount_paise, t.nav, t.units, t.notes
       FROM investment_txns t JOIN funds f ON f.id = t.fund_id
       WHERE t.fy_start_year = ? ORDER BY t.txn_date`,
    )
    .all(fyStartYear) as Array<Record<string, unknown>>;
  if (invTxns.length) {
    addTableSheet(wb, "Investments", ["Date", "Fund", "Type", "Amount", "NAV", "Units", "Notes"],
      invTxns.map((t) => [
        isoToDate(t.txn_date as string), t.fund, t.txn_type,
        (t.amount_paise as number) / 100, t.nav, t.units, t.notes,
      ]), { dateCols: [1], moneyCols: [4] });
  }

  const holdings = listHoldings();
  if (holdings.length) {
    addTableSheet(wb, "Holdings",
      ["Fund", "Asset Class", "Sub-category", "Units", "Cost Basis", "Last NAV", "Market Value"],
      holdings.map((h) => [
        h.name, h.asset_class, h.sub_category, h.units,
        h.cost_basis_paise / 100, h.last_nav,
        h.market_value_paise !== null ? h.market_value_paise / 100 : null,
      ]), { moneyCols: [5, 7] });
  }

  const { goals, unassigned } = goalAttribution();
  if (goals.length) {
    addTableSheet(wb, "Goals",
      ["Goal", "Since", "SIP share %", "Invested", "Value", "Gain", "XIRR %"],
      [
        ...goals.map((g) => [
          g.name, g.start_date, g.sip_share_pct, g.cost_paise / 100,
          g.value_paise !== null ? g.value_paise / 100 : null,
          g.pnl_paise !== null ? g.pnl_paise / 100 : null,
          g.xirr_pct !== null ? Number(g.xirr_pct.toFixed(2)) : null,
        ]),
        ["Unassigned", null, null, unassigned.cost_paise / 100,
          unassigned.value_paise !== null ? unassigned.value_paise / 100 : null,
          unassigned.pnl_paise !== null ? unassigned.pnl_paise / 100 : null, null],
      ],
      { moneyCols: [4, 5, 6] });
  }

  const fds = listFixedDeposits();
  if (fds.length) {
    addTableSheet(wb, "Fixed_Deposits",
      ["FD No", "Principal", "Rate %", "Start", "Maturity", "Maturity Amount", "Status"],
      fds.map((fd) => [
        fd.fd_number, fd.principal_paise / 100, fd.interest_rate_bp / 100,
        isoToDate(fd.start_date), isoToDate(fd.maturity_date),
        fd.maturity_amount_paise !== null ? fd.maturity_amount_paise / 100 : null, fd.status,
      ]), { dateCols: [4, 5], moneyCols: [2, 6] });
  }

  const invoices = conn
    .prepare(`SELECT * FROM invoices ORDER BY issue_date`)
    .all() as Array<Record<string, unknown>>;
  if (invoices.length) {
    addTableSheet(wb, "Invoices",
      ["Invoice No", "Client", "Date", "Currency", "Amount", "Rate", "Amount INR", "Status"],
      invoices.map((i) => [
        i.invoice_no, i.client, isoToDate(i.issue_date as string), i.currency,
        (i.amount_minor as number) / 100, i.conversion_rate,
        (i.amount_inr_paise as number) / 100, i.status,
      ]), { dateCols: [3], moneyCols: [5, 7] });
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

function addTableSheet(
  wb: ExcelJS.Workbook,
  name: string,
  columns: string[],
  rows: unknown[][],
  opts?: { dateCols?: number[]; moneyCols?: number[]; widths?: Record<number, number> },
): void {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.addTable({
    name: name.replace(/[^A-Za-z0-9_]/g, "_"),
    ref: "A1",
    headerRow: true,
    style: { theme: "TableStyleMedium2", showRowStripes: true },
    columns: columns.map((c) => ({ name: c, filterButton: true })),
    rows: rows.length ? rows : [columns.map(() => null)],
  });
  for (const c of opts?.dateCols ?? []) ws.getColumn(c).numFmt = "yyyy-mm-dd";
  for (const c of opts?.moneyCols ?? []) ws.getColumn(c).numFmt = MONEY_FMT;
  columns.forEach((col, i) => {
    ws.getColumn(i + 1).width = opts?.widths?.[i + 1] ?? Math.max(12, Math.min(24, col.length + 6));
  });
}
