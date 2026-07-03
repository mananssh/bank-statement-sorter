import "server-only";
import { db } from "@/lib/db/client";
import { openWorkbook } from "@/lib/parsers/workbook";
import { cellToString, normalizeHeaderCell } from "@/lib/parsers/grid";
import { coerceDate } from "@/lib/normalize/dates";
import { parseAmountToPaise } from "@/lib/domain/money";
import { fyStartYear } from "@/lib/domain/fy";
import { fyStartMonth, setSetting } from "@/lib/repos/settings";

/**
 * One-time migration from an investments workbook in the
 * Setup / Fund_Master / Investment_Log / Party_Allocator format:
 * funds catalog, SIP/lumpsum log, goal buckets, and SIP-budget/80C settings.
 */

export interface InvestmentsBootstrapResult {
  funds: number;
  txns: number;
  goals: number;
}

export async function bootstrapInvestments(
  buffer: Buffer,
  password?: string,
): Promise<InvestmentsBootstrapResult> {
  const wb = await openWorkbook(buffer, password);
  const conn = db();
  const startMonth = fyStartMonth();

  let funds = 0;
  let txns = 0;
  let goals = 0;

  // --- Fund_Master → funds ---------------------------------------------------
  const fundSheet = wb.sheetNames.find((s) => /fund[_ ]?master/i.test(s));
  const fundIdMap = new Map<string, number>(); // sheet Fund_ID -> db id
  if (fundSheet) {
    const grid = wb.grid(fundSheet);
    const header = grid[0]?.map(normalizeHeaderCell) ?? [];
    const col = (p: RegExp) => header.findIndex((h) => p.test(h));
    const cId = col(/^fund id$/);
    const cName = col(/^fund name$/);
    const cClass = col(/^asset class$/);
    const cSub = col(/^sub category$/);
    const cElss = col(/is elss/);
    const cPlatform = col(/platform/);
    const cIsin = col(/^isin$/);
    const cSip = col(/is sip active/);

    const insert = conn.prepare(
      `INSERT INTO funds (name, asset_class, sub_category, is_elss, platform, isin, is_sip_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET isin = COALESCE(excluded.isin, funds.isin)`,
    );
    for (let r = 1; r < grid.length; r++) {
      const name = cName >= 0 ? cellToString(grid[r]?.[cName]) : "";
      if (!name) continue;
      const assetClassRaw = (cClass >= 0 ? cellToString(grid[r]?.[cClass]) : "").toLowerCase();
      const assetClass = ["equity", "debt", "gold", "elss", "hybrid"].find((a) =>
        assetClassRaw.includes(a),
      ) ?? "other";
      insert.run(
        name,
        assetClass,
        cSub >= 0 ? cellToString(grid[r]?.[cSub]) || null : null,
        cElss >= 0 && /yes|true|1/i.test(cellToString(grid[r]?.[cElss])) ? 1 : 0,
        cPlatform >= 0 ? cellToString(grid[r]?.[cPlatform]) || null : null,
        cIsin >= 0 ? cellToString(grid[r]?.[cIsin]) || null : null,
        cSip >= 0 && /yes|true|1/i.test(cellToString(grid[r]?.[cSip])) ? 1 : 0,
      );
      funds++;
      const dbId = (
        conn.prepare(`SELECT id FROM funds WHERE name = ?`).get(name) as { id: number }
      ).id;
      const sheetId = cId >= 0 ? cellToString(grid[r]?.[cId]) : "";
      if (sheetId) fundIdMap.set(sheetId, dbId);
      fundIdMap.set(name.toLowerCase(), dbId);
    }
  }

  // --- Investment_Log → investment_txns --------------------------------------
  const logSheet = wb.sheetNames.find((s) => /investment[_ ]?log/i.test(s));
  if (logSheet) {
    const grid = wb.grid(logSheet);
    const header = grid[0]?.map(normalizeHeaderCell) ?? [];
    const col = (p: RegExp) => header.findIndex((h) => p.test(h));
    const cDate = col(/^date$/);
    const cFundId = col(/^fund id$/);
    const cFundName = col(/^fund name$/);
    const cType = col(/^txn type$/);
    const cAmount = col(/amount invested/);
    const cNav = col(/nav/);
    const cUnits = col(/units final|units calculated|^units/);
    const cNotes = col(/^notes$/);

    const insert = conn.prepare(
      `INSERT INTO investment_txns
         (fund_id, txn_date, txn_type, amount_paise, nav, units, fy_start_year, notes, order_no)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(order_no) DO NOTHING`,
    );
    for (let r = 1; r < grid.length; r++) {
      const row = grid[r];
      if (!row) continue;
      const date = cDate >= 0 ? coerceDate(row[cDate]) : null;
      const amount = cAmount >= 0 ? parseAmountToPaise(row[cAmount] as string | number) : null;
      if (!date || !amount) continue;

      const fundKey =
        (cFundId >= 0 ? cellToString(row[cFundId]) : "") ||
        (cFundName >= 0 ? cellToString(row[cFundName]).toLowerCase() : "");
      const fundId = fundIdMap.get(fundKey);
      if (!fundId) continue;

      const typeRaw = (cType >= 0 ? cellToString(row[cType]) : "sip").toLowerCase();
      const type = /sell|redeem/.test(typeRaw)
        ? "sell"
        : /dividend/.test(typeRaw)
          ? "dividend"
          : /lump/.test(typeRaw)
            ? "lumpsum"
            : "sip";

      const nav = cNav >= 0 ? Number(cellToString(row[cNav]).replace(/,/g, "")) || null : null;
      const units = cUnits >= 0 ? Number(cellToString(row[cUnits]).replace(/,/g, "")) || null : null;

      // Synthetic natural key prevents duplicate rows across repeated bootstraps.
      const orderNo = `BOOT-${fundId}-${date}-${amount}-${r}`;
      const res = insert.run(
        fundId,
        date,
        type,
        amount,
        nav,
        units,
        fyStartYear(date, startMonth),
        cNotes >= 0 ? cellToString(row[cNotes]) || null : null,
        orderNo,
      );
      if (res.changes > 0) txns++;
    }
  }

  // --- Party_Allocator → goals -----------------------------------------------
  const allocSheet = wb.sheetNames.find((s) => /party[_ ]?allocator|goal/i.test(s));
  if (allocSheet) {
    const grid = wb.grid(allocSheet);
    const insert = conn.prepare(
      `INSERT INTO goals (name, allocation_pct, notes) VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET allocation_pct = excluded.allocation_pct`,
    );
    // Locate the Party_ID / Party_Name / Allocation_% header wherever it sits.
    for (let r = 0; r < Math.min(6, grid.length); r++) {
      const header = grid[r]?.map(normalizeHeaderCell) ?? [];
      const cName = header.findIndex((h) => /^party name$|^goal/.test(h));
      const cPct = header.findIndex((h) => /allocation/.test(h));
      const cDesc = header.findIndex((h) => /description/.test(h));
      if (cName < 0 || cPct < 0) continue;
      for (let d = r + 1; d < grid.length; d++) {
        const name = cellToString(grid[d]?.[cName]);
        const pctRaw = Number(cellToString(grid[d]?.[cPct]));
        if (!name || !Number.isFinite(pctRaw) || pctRaw <= 0) continue;
        const pct = pctRaw <= 1 ? pctRaw * 100 : pctRaw;
        insert.run(name, pct, cDesc >= 0 ? cellToString(grid[d]?.[cDesc]) || null : null);
        goals++;
      }
      break;
    }
  }

  // --- Setup → SIP budget / 80C settings --------------------------------------
  const setupSheet = wb.sheetNames.find((s) => /^setup$/i.test(s));
  if (setupSheet) {
    const grid = wb.grid(setupSheet);
    for (const row of grid) {
      const key = normalizeHeaderCell(row?.[0]);
      const value = row?.[1];
      if (/monthly sip budget/.test(key)) {
        const paise = parseAmountToPaise(value as string | number);
        if (paise) setSetting("sip_budget_paise", paise);
      }
      if (/elss annual.*ceiling|80c ceiling/.test(key)) {
        const paise = parseAmountToPaise(value as string | number);
        if (paise) setSetting("ceiling_80c_paise", paise);
      }
    }
  }

  return { funds, txns, goals };
}
