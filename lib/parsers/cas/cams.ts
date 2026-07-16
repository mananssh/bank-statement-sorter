import {
  CAS_DATE_RE,
  ISIN_RE,
  casDateToIso,
  parseCasNumber,
  toPaise,
} from "@/lib/parsers/cas/common";

/**
 * CAMS/KFintech detailed Consolidated Account Statement parser (pure — no DB,
 * no network). Works on the text lines produced by pdf-text.ts.
 *
 * Document shape (per casparser's long-standing reading of the format):
 *   <period header: "01-Aug-2026 To 31-Aug-2026">
 *   Folio No: 12345678 / 0   PAN: XXXXX  KYC: OK
 *   <rta-code>-<Scheme Name> (Advisor: ARN-...) Registrar : CAMS
 *   ISIN: INF123A01ABC                              (same or nearby line)
 *   Opening Unit Balance: 0.000
 *   01-Aug-2026  Purchase - via distributor   5,000.00   12.345  405.05  12.345
 *   02-Aug-2026  *** Stamp Duty ***           0.25
 *   Closing Unit Balance: 123.456  NAV on 31-Aug-2026: INR 405.90 ...
 *
 * Layout details vary by RTA/AMC, so every regex here is tolerant; anything
 * unrecognized is skipped, and dev-cas-check.ts exists to eyeball real files.
 */

export type CamsTxnType = "sip" | "lumpsum" | "sell" | "dividend" | "dividend_reinvest";

export interface CamsTxn {
  date: string; // ISO
  description: string;
  amount_paise: number; // signed as printed (redemptions negative)
  units: number | null;
  nav: number | null;
  unit_balance: number | null;
  type: CamsTxnType;
}

export interface CamsScheme {
  name: string;
  isin: string | null;
  folio: string | null;
  rta: string | null;
  opening_units: number | null;
  closing_units: number | null;
  closing_nav: number | null;
  closing_nav_date: string | null;
  txns: CamsTxn[];
  charges_skipped: number; // stamp duty / STT / TDS rows (informational)
}

export interface CamsCas {
  period_from: string | null;
  period_to: string | null;
  schemes: CamsScheme[];
}

export function looksLikeCamsCas(pages: string[][]): boolean {
  const text = pages.flat().join("\n");
  return /consolidated account statement/i.test(text) && /folio no/i.test(text);
}

const PERIOD_RE = new RegExp(`(${CAS_DATE_RE.source})\\s+To\\s+(${CAS_DATE_RE.source})`, "i");
const FOLIO_RE = /Folio No\s*:?\s*([0-9][\w\s/.-]*?)(?=\s+(?:PAN|KYC|$)|$)/i;
const SCHEME_RE = /^(.+?)\s*(?:\(\s*Advisor\s*:[^)]*\))?\s*Registrar\s*:\s*(\S+)/i;
const ISIN_LINE_RE = new RegExp(`ISIN\\s*:?\\s*(${ISIN_RE.source.replace(/\\b/g, "")})`, "i");
const OPENING_RE = /Opening Unit Balance\s*:?\s*([\d,.]+)/i;
const CLOSING_RE = /Closing Unit Balance\s*:?\s*([\d,.]+)/i;
const CLOSING_NAV_RE = new RegExp(
  `NAV on (${CAS_DATE_RE.source})\\s*:?\\s*(?:INR\\s*)?([\\d,.]+)`,
  "i",
);
// date + description + 4 numbers (amount, units, price/NAV, unit balance)
const TXN_RE = new RegExp(
  `^(${CAS_DATE_RE.source})\\s+(.+?)\\s+(\\(?-?[\\d,]+\\.?\\d*\\)?)\\s+(\\(?-?[\\d,]+\\.?\\d*\\)?)\\s+(\\(?-?[\\d,]+\\.?\\d*\\)?)\\s+(\\(?-?[\\d,]+\\.?\\d*\\)?)$`,
);
// date + description + 1 number: charge rows (stamp duty, STT, TDS) and
// non-unit cash rows (IDCW payout on some layouts)
const TXN_NO_UNITS_RE = new RegExp(
  `^(${CAS_DATE_RE.source})\\s+(.+?)\\s+(\\(?-?[\\d,]+\\.?\\d*\\)?)$`,
);
const CHARGE_RE = /stamp duty|stt paid|\btds\b|tax deducted/i;

function classify(desc: string, units: number | null): CamsTxnType {
  const d = desc.toLowerCase();
  if (/reinvest/.test(d)) return "dividend_reinvest";
  if (/idcw|dividend/.test(d)) return "dividend";
  if ((units !== null && units < 0) || /redemption|switch\s*.?\s*out|lateral shift out/.test(d)) {
    return "sell";
  }
  if (/systematic|\bsip\b|sys\.? inv/.test(d)) return "sip";
  return "lumpsum";
}

/** Strip the leading RTA scheme code ("128TSDGG-") off a scheme-header name. */
function cleanSchemeName(raw: string): string {
  return raw
    .replace(/^[A-Z0-9]{2,15}-\s*/i, "")
    .replace(ISIN_LINE_RE, "")
    .replace(/\(\s*formerly[^)]*\)/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[-–\s]+$/, "");
}

export function parseCamsCas(pages: string[][]): CamsCas {
  const lines = pages.flat();
  const cas: CamsCas = { period_from: null, period_to: null, schemes: [] };
  let folio: string | null = null;
  let scheme: CamsScheme | null = null;

  for (const line of lines) {
    if (!cas.period_from) {
      const p = line.match(PERIOD_RE);
      if (p) {
        cas.period_from = casDateToIso(p[1]);
        cas.period_to = casDateToIso(p[2]);
      }
    }

    const f = line.match(FOLIO_RE);
    if (f) {
      folio = f[1].trim();
      continue;
    }

    if (/Registrar\s*:/i.test(line)) {
      const s = line.match(SCHEME_RE);
      if (s) {
        scheme = {
          name: cleanSchemeName(s[1]),
          isin: line.match(ISIN_LINE_RE)?.[1]?.toUpperCase() ?? null,
          folio,
          rta: s[2],
          opening_units: null,
          closing_units: null,
          closing_nav: null,
          closing_nav_date: null,
          txns: [],
          charges_skipped: 0,
        };
        cas.schemes.push(scheme);
        continue;
      }
    }

    if (!scheme) continue;

    // ISIN sometimes sits on its own line under the scheme header.
    if (!scheme.isin && scheme.txns.length === 0) {
      const i = line.match(ISIN_LINE_RE);
      if (i) scheme.isin = i[1].toUpperCase();
    }

    const open = line.match(OPENING_RE);
    if (open) {
      scheme.opening_units = parseCasNumber(open[1]);
      continue;
    }
    const close = line.match(CLOSING_RE);
    if (close) {
      scheme.closing_units = parseCasNumber(close[1]);
      const nav = line.match(CLOSING_NAV_RE);
      if (nav) {
        scheme.closing_nav_date = casDateToIso(nav[1]);
        scheme.closing_nav = parseCasNumber(nav[2]);
      }
      continue;
    }
    if (scheme.closing_nav === null) {
      const nav = line.match(CLOSING_NAV_RE);
      if (nav) {
        scheme.closing_nav_date = casDateToIso(nav[1]);
        scheme.closing_nav = parseCasNumber(nav[2]);
        continue;
      }
    }

    const t = line.match(TXN_RE);
    if (t) {
      const date = casDateToIso(t[1]);
      const amount = parseCasNumber(t[3]);
      if (date === null || amount === null) continue;
      if (CHARGE_RE.test(t[2])) {
        scheme.charges_skipped++;
        continue;
      }
      const units = parseCasNumber(t[4]);
      scheme.txns.push({
        date,
        description: t[2].replace(/\s+/g, " ").trim(),
        amount_paise: toPaise(amount),
        units,
        nav: parseCasNumber(t[5]),
        unit_balance: parseCasNumber(t[6]),
        type: classify(t[2], units),
      });
      continue;
    }

    const tn = line.match(TXN_NO_UNITS_RE);
    if (tn) {
      const date = casDateToIso(tn[1]);
      const amount = parseCasNumber(tn[3]);
      if (date === null || amount === null) continue;
      if (CHARGE_RE.test(tn[2]) || /\*{2,}/.test(tn[2])) {
        scheme.charges_skipped++;
        continue;
      }
      const type = classify(tn[2], null);
      // A unit-less row only makes sense as cash in/out (IDCW payout etc.).
      if (type !== "dividend") continue;
      scheme.txns.push({
        date,
        description: tn[2].replace(/\s+/g, " ").trim(),
        amount_paise: toPaise(amount),
        units: null,
        nav: null,
        unit_balance: null,
        type,
      });
    }
  }

  // Drop schemes that parsed as headers but yielded nothing usable.
  cas.schemes = cas.schemes.filter(
    (s) => s.txns.length > 0 || s.closing_units !== null || s.opening_units !== null,
  );
  return cas;
}
