import { CAS_DATE_RE, ISIN_RE, casDateToIso, parseCasNumber, toPaise } from "@/lib/parsers/cas/common";

/**
 * NSDL/CDSL e-CAS parser (pure — no DB, no network). Extracts the holdings
 * snapshot: every line carrying an ISIN becomes a holding candidate.
 *
 * The e-CAS layout varies a lot more than the CAMS one (tables differ between
 * equities, demat MF units, and SoA mutual-fund folios, and cell counts vary
 * by section), so instead of fixed column positions this parser collects the
 * numeric tokens on each ISIN line and picks the (units, price, value) triple
 * where units × price ≈ value — which holds in every NSDL/CDSL table variant
 * that shows a valuation. Lines where no triple fits fall back to
 * units = first number / value = last number.
 */

export interface NsdlHolding {
  isin: string;
  name: string;
  units: number | null;
  price: number | null; // market price / NAV per unit, in rupees
  value_paise: number | null;
  kind: "equity" | "fund"; // by ISIN prefix: INE… = equity, INF… = MF/ETF
}

export interface NsdlCas {
  statement_date: string | null; // period end / "as on" date
  period_from: string | null;
  holdings: NsdlHolding[];
}

export function looksLikeNsdlCas(pages: string[][]): boolean {
  const text = pages.flat().join("\n");
  return (
    /NSDL|CDSL|National Securities Depository|Central Depository/i.test(text) &&
    /demat|depository|e-?CAS/i.test(text)
  );
}

const PERIOD_RE = new RegExp(
  `(?:from\\s+)?(${CAS_DATE_RE.source})\\s+to\\s+(${CAS_DATE_RE.source})`,
  "i",
);
const AS_ON_RE = new RegExp(`as on\\s*:?\\s*(${CAS_DATE_RE.source})`, "i");
const ISIN_G = new RegExp(ISIN_RE.source, "g");
// numeric cell: needs a decimal point or comma grouping (bare integers are
// too often part of names/codes to trust)
const NUM_TOKEN_RE = /^\(?-?\d[\d,]*\.\d+\)?$|^\(?-?\d{1,3}(,\d{2,3})+\)?$/;

interface Fit {
  units: number;
  price: number;
  value: number;
}

/** Pick (units, price, value) from a line's numeric cells: units×price ≈ value. */
function fitTriple(nums: number[]): Fit | null {
  // Prefer the rightmost plausible triple — value is the last column in every
  // NSDL/CDSL layout, and price sits next to it.
  for (let v = nums.length - 1; v >= 2; v--) {
    const value = nums[v];
    if (value <= 0) continue;
    for (let p = v - 1; p >= 1; p--) {
      for (let u = p - 1; u >= 0; u--) {
        const price = nums[p];
        const units = nums[u];
        if (price <= 0 || units <= 0) continue;
        if (Math.abs(units * price - value) / value < 0.02) return { units, price, value };
      }
    }
  }
  return null;
}

export function parseNsdlCas(pages: string[][]): NsdlCas {
  const lines = pages.flat();
  const cas: NsdlCas = { statement_date: null, period_from: null, holdings: [] };
  const byIsin = new Map<string, NsdlHolding>();

  for (const line of lines) {
    if (!cas.statement_date) {
      const p = line.match(PERIOD_RE);
      if (p) {
        cas.period_from = casDateToIso(p[1]);
        cas.statement_date = casDateToIso(p[2]);
      } else {
        const a = line.match(AS_ON_RE);
        if (a) cas.statement_date = casDateToIso(a[1]);
      }
    }

    const isins = line.match(ISIN_G);
    if (!isins || isins.length !== 1) continue; // header/legend lines list many
    const isin = isins[0].toUpperCase();

    const after = line.slice(line.indexOf(isins[0]) + isins[0].length).trim();
    const tokens = after.split(/\s+/);
    const nums: number[] = [];
    const nameParts: string[] = [];
    for (const tok of tokens) {
      if (NUM_TOKEN_RE.test(tok)) {
        const n = parseCasNumber(tok);
        if (n !== null) {
          nums.push(n);
          continue;
        }
      }
      // name cells come before the numeric cells; ignore trailing stray text
      if (nums.length === 0) nameParts.push(tok);
    }
    const name = nameParts.join(" ").replace(/\s+/g, " ").trim();
    if (!name && nums.length === 0) continue;

    const fit = fitTriple(nums);
    const holding: NsdlHolding = {
      isin,
      name,
      units: fit ? fit.units : (nums[0] ?? null),
      price: fit ? fit.price : null,
      value_paise: fit ? toPaise(fit.value) : nums.length > 1 ? toPaise(nums[nums.length - 1]) : null,
      kind: isin.startsWith("INF") ? "fund" : "equity",
    };

    // The same ISIN can appear in a holdings table and again in a summary —
    // keep the row with the most information.
    const existing = byIsin.get(isin);
    const score = (h: NsdlHolding) =>
      (h.units !== null ? 1 : 0) + (h.price !== null ? 1 : 0) + (h.value_paise !== null ? 1 : 0);
    if (!existing || score(holding) > score(existing)) byIsin.set(isin, holding);
  }

  cas.holdings = [...byIsin.values()];
  return cas;
}
