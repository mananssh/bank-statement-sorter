import { parseAmountToPaise } from "@/lib/domain/money";
import type { AmountStyle, Direction } from "@/lib/db/types";

export interface AmountResult {
  amount_paise: number;
  direction: Direction;
}

/**
 * Resolve amount + direction from raw cells according to the preset's
 * amount style:
 *  - debit_credit_columns: separate Debit / Credit columns (bank statements)
 *  - signed_amount:        one column, sign = direction
 *  - amount_with_drcr_flag: one amount column + a Dr/Cr flag column
 */
export function resolveAmount(
  style: AmountStyle,
  cells: { debit?: unknown; credit?: unknown; amount?: unknown; drcr?: unknown },
): AmountResult | null {
  switch (style) {
    case "debit_credit_columns": {
      const debit = cellToPaise(cells.debit);
      const credit = cellToPaise(cells.credit);
      if (debit && debit > 0) return { amount_paise: debit, direction: "debit" };
      if (credit && credit > 0) return { amount_paise: credit, direction: "credit" };
      return null;
    }
    case "signed_amount": {
      const raw = cells.amount;
      const paise = cellToPaise(raw);
      if (!paise) return null;
      const negative =
        (typeof raw === "number" && raw < 0) ||
        (typeof raw === "string" && /^\s*[-(]/.test(raw));
      return { amount_paise: paise, direction: negative ? "debit" : "credit" };
    }
    case "amount_with_drcr_flag": {
      const paise = cellToPaise(cells.amount);
      if (!paise) return null;
      const flag = String(cells.drcr ?? "").trim().toLowerCase();
      // Default to debit: most flagged formats are card statements where
      // spends dominate and credits are explicitly marked.
      const direction: Direction = flag.startsWith("cr") ? "credit" : "debit";
      return { amount_paise: paise, direction };
    }
  }
}

function cellToPaise(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "string") {
    const paise = parseAmountToPaise(value);
    return paise && paise > 0 ? paise : null;
  }
  return null;
}
