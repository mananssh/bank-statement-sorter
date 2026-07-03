import type {
  CanonicalMfOrder,
  CanonicalTxn,
  Grid,
  MappingSpec,
  ParseIssue,
  ParseResult,
} from "@/lib/parsers/types";
import { cellToString, rowIsEmpty } from "@/lib/parsers/grid";
import { coerceDate } from "@/lib/normalize/dates";
import { resolveAmount } from "@/lib/normalize/amounts";
import { parseAmountToPaise } from "@/lib/domain/money";
import { getNarrationPlugin } from "@/lib/normalize/narration";

/**
 * Preset-driven parsing: grid + mapping spec → canonical rows. This is fully
 * generic — institution specifics live in the mapping (saved preset) and the
 * narration plugin, so any bank's export parses through the same path.
 */
export function parseGrid(grid: Grid, spec: MappingSpec, formatted?: string[][]): ParseResult {
  return spec.statementKind === "mf_orders"
    ? parseMfOrders(grid, spec, formatted)
    : parseBankLike(grid, spec, formatted);
}

/** True for a raw cell that carries no usable value (so we fall back to formatted text). */
function isEmptyCell(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

function parseBankLike(grid: Grid, spec: MappingSpec, formatted?: string[][]): ParseResult {
  const txns: CanonicalTxn[] = [];
  const issues: ParseIssue[] = [];
  const plugin = getNarrationPlugin(spec.narrationPlugin);
  const map = spec.columnMap;

  // Raw cell, falling back to the formatted display text when the raw value is
  // empty — handles "General"-formatted cells that read back as blanks/typed
  // text differently than their display.
  const cell = (row: unknown[], field: keyof typeof map, r: number): unknown => {
    if (map[field] === undefined) return undefined;
    const raw = row[map[field]!];
    if (!isEmptyCell(raw)) return raw;
    const fmt = formatted?.[r]?.[map[field]!];
    return fmt !== undefined && fmt !== "" ? fmt : raw;
  };

  for (let r = spec.dataStartRow; r < grid.length; r++) {
    const row = grid[r];
    if (rowIsEmpty(row)) continue;

    const rawDate = cell(row, "date", r);
    const narration = cellToString(cell(row, "narration", r));

    const amount = resolveAmount(spec.amountStyle, {
      debit: cell(row, "debit", r),
      credit: cell(row, "credit", r),
      amount: cell(row, "amount", r),
      drcr: cell(row, "drcr", r),
    });

    // Statement preamble/footer (bank header block, "Generated On …",
    // GST/legal footers, opening/closing-balance lines, totals) carries no
    // money in the mapped amount columns — drop it silently rather than
    // flagging it, since every bank's boilerplate differs. Only a row that
    // looks like a real transaction (has an amount) is worth surfacing when a
    // field fails to parse.
    // Try the raw cell first, then the formatted display text (covers dates in
    // "General"-formatted columns that read back ambiguously).
    const dateColIdx = map.date;
    const rawDateFmt =
      dateColIdx !== undefined ? formatted?.[r]?.[dateColIdx] : undefined;
    const txn_date =
      coerceDate(rawDate, { dayFirst: spec.dayFirst ?? true }) ??
      (rawDateFmt ? coerceDate(rawDateFmt, { dayFirst: spec.dayFirst ?? true }) : null);
    if (!txn_date) {
      if (amount && !isBoilerplate(row)) {
        issues.push({ row_no: r + 1, raw: row.slice(0, 10), error: "Unparseable date" });
      }
      continue;
    }
    if (!amount) {
      // Dated row with no amount and not obvious boilerplate — likely a real
      // parse problem (wrong amount column) worth showing.
      if (!isBoilerplate(row)) {
        issues.push({ row_no: r + 1, raw: row.slice(0, 10), error: "No parseable amount" });
      }
      continue;
    }

    const balanceRaw = cell(row, "balance", r);
    const balanceAbs =
      balanceRaw !== undefined && balanceRaw !== null ? parseAmountToPaise(balanceRaw as string | number) : null;
    // parseAmountToPaise returns absolute value; recover the sign for
    // overdrawn balances shown as negatives.
    const balanceNegative =
      (typeof balanceRaw === "number" && balanceRaw < 0) ||
      (typeof balanceRaw === "string" && /^\s*[-(]/.test(balanceRaw));
    const balance_paise = balanceAbs === null ? null : balanceNegative ? -balanceAbs : balanceAbs;

    const extraction = plugin.parse(narration);

    txns.push({
      row_no: r + 1,
      txn_date,
      narration,
      ref_number: cellToString(cell(row, "ref_number", r)) || null,
      direction: amount.direction,
      amount_paise: amount.amount_paise,
      balance_paise,
      channel: extraction.channel,
      counterparty_raw: extraction.counterparty,
      counterparty_vpa: extraction.vpa,
      upi_rrn: extraction.rrn,
      upi_note: extraction.upiNote,
      parsed: {
        ...(extraction.ifsc ? { ifsc: extraction.ifsc } : {}),
        ...(extraction.cardLast4 ? { card_last4: extraction.cardLast4 } : {}),
        ...(cellToString(cell(row, "value_date", r))
          ? { value_date: coerceDate(cell(row, "value_date", r), { dayFirst: spec.dayFirst ?? true }) }
          : {}),
      },
    });
  }

  return { txns, mfOrders: [], issues };
}

const BOILERPLATE_RE =
  /\b(generated on|statement of account|opening balance|closing balance|account (no|number|branch)|customer id|ifsc|micr|gstn?|nominee|page \d|total (debit|credit|amount)?|grand total|registered office|this is a (computer|system)|end of statement|branch code)\b/i;

/** True when a row is statement preamble/footer rather than a transaction. */
function isBoilerplate(row: unknown[]): boolean {
  const joined = row.map(cellToString).join(" ").trim();
  if (joined === "") return true;
  return BOILERPLATE_RE.test(joined);
}

function parseMfOrders(grid: Grid, spec: MappingSpec, formatted?: string[][]): ParseResult {
  const mfOrders: CanonicalMfOrder[] = [];
  const issues: ParseIssue[] = [];
  const map = spec.columnMap;

  const cell = (row: unknown[], field: keyof typeof map, r: number): unknown => {
    if (map[field] === undefined) return undefined;
    const raw = row[map[field]!];
    if (!isEmptyCell(raw)) return raw;
    const fmt = formatted?.[r]?.[map[field]!];
    return fmt !== undefined && fmt !== "" ? fmt : raw;
  };

  for (let r = spec.dataStartRow; r < grid.length; r++) {
    const row = grid[r];
    if (rowIsEmpty(row)) continue;

    const order_date = coerceDate(cell(row, "order_date", r) ?? cell(row, "date", r), {
      dayFirst: spec.dayFirst ?? true,
    });
    const scheme_name = cellToString(cell(row, "scheme_name", r));
    const amountPaise = parseAmountToPaise(cell(row, "amount", r) as string | number);

    // Order books interleave stamp-duty/charge rows that lack scheme/ISIN —
    // skip them silently rather than failing the import.
    if (!order_date || !scheme_name) continue;
    if (!amountPaise) {
      issues.push({ row_no: r + 1, raw: row.slice(0, 10), error: "No parseable amount" });
      continue;
    }

    const sideRaw = cellToString(cell(row, "side", r)).toLowerCase();
    const side: "buy" | "sell" = /sell|redeem|redemption/.test(sideRaw) ? "sell" : "buy";

    const unitsRaw = cellToString(cell(row, "units", r));
    const navRaw = cellToString(cell(row, "nav", r));

    mfOrders.push({
      row_no: r + 1,
      order_no: cellToString(cell(row, "order_no", r)) || null,
      order_date,
      isin: cellToString(cell(row, "isin", r)) || null,
      scheme_name,
      folio: cellToString(cell(row, "folio", r)) || null,
      side,
      units: unitsRaw ? Math.abs(Number(unitsRaw.replace(/,/g, ""))) || null : null,
      nav: navRaw ? Number(navRaw.replace(/,/g, "")) || null : null,
      amount_paise: amountPaise,
    });
  }

  return { txns: [], mfOrders, issues };
}
