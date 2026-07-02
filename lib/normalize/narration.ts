import type { Channel } from "@/lib/db/types";

/**
 * Narration mining. Bank narrations pack the counterparty, UPI VPA, reference
 * numbers, and even the user-typed UPI message into one string. Extraction is
 * per-institution via plugins; the generic plugin covers channel detection and
 * VPA spotting so unknown banks still get partial structure.
 *
 * Extraction is anchor-based (find the VPA / the 12-digit RRN, then read the
 * segments around them) rather than one giant regex, because payee names
 * routinely contain the '-' delimiter.
 */

export interface NarrationExtraction {
  channel: Channel | null;
  counterparty: string | null;
  vpa: string | null;
  rrn: string | null; // UPI RRN or NEFT/IMPS UTR
  upiNote: string | null; // user-typed UPI message
  ifsc: string | null;
  cardLast4: string | null;
}

export interface NarrationPlugin {
  id: string;
  label: string;
  parse(narration: string): NarrationExtraction;
}

const EMPTY: NarrationExtraction = {
  channel: null,
  counterparty: null,
  vpa: null,
  rrn: null,
  upiNote: null,
  ifsc: null,
  cardLast4: null,
};

const VPA_RE = /[\w.\-]{2,}@[a-z][a-z0-9]{1,15}/i;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export function detectChannel(narration: string): Channel | null {
  const n = narration.trim().toUpperCase();
  if (/^UPI[-\/ ]/.test(n)) return "upi";
  if (/^NEFT\s?(CR|DR)?[- ]/.test(n) || /^NEFT-/.test(n)) return "neft";
  if (/^IMPS[-\/ ]/.test(n)) return "imps";
  if (/^RTGS/.test(n)) return "rtgs";
  if (/^POS\s/.test(n) || /^ME\s+DC\s/.test(n)) return "pos";
  if (/^\d{10,16}-TPT-/.test(n) || /^TPT-/.test(n)) return "tpt";
  if (/^ACH\s?[CD]?[- ]/.test(n) || /^ACH-/.test(n)) return "ach";
  if (/\b(ATM|NWD|EAW|CASH WDL)\b/.test(n)) return "atm";
  if (/^INT(EREST)?\b/.test(n) || /\bINTEREST (PAID|CREDIT)/.test(n)) return "interest";
  if (/\bEMI\b/.test(n)) return "emi";
  if (/^(CHQ|CHEQUE)\b/.test(n)) return "cheque";
  if (/\bFD\b|\bFIXED DEPOSIT\b|\bRD INSTALLMENT\b/.test(n)) return "fd";
  if (/\b(FEE|CHARGES?|IGST|CGST|SGST|GST)\b/.test(n)) return "fee";
  return null;
}

function cleanSegment(s: string | undefined | null): string | null {
  const t = (s ?? "").replace(/\s+/g, " ").trim().replace(/^[-–]+|[-–]+$/g, "").trim();
  return t.length > 0 ? t : null;
}

/** Generic fallback: channel + VPA spotting only. Never blocks an import. */
export const genericPlugin: NarrationPlugin = {
  id: "generic",
  label: "Generic",
  parse(narration) {
    const channel = detectChannel(narration);
    const vpa = narration.match(VPA_RE)?.[0]?.toLowerCase() ?? null;
    return { ...EMPTY, channel, vpa };
  },
};

/** HDFC Bank narration formats. */
export const hdfcPlugin: NarrationPlugin = {
  id: "hdfc",
  label: "HDFC Bank",
  parse(narration) {
    const raw = narration.replace(/\s+/g, " ").trim();
    const channel = detectChannel(raw);

    switch (channel) {
      case "upi":
        return parseHdfcUpi(raw);
      case "neft":
        return parseHdfcNeft(raw);
      case "imps":
        return parseHdfcImps(raw);
      case "tpt":
        return parseHdfcTpt(raw);
      case "pos":
        return parseHdfcPos(raw);
      default:
        return { ...genericPlugin.parse(raw), channel };
    }
  },
};

/** UPI-<payee>-<vpa>-<ifsc or bank>-<rrn>-<note...> */
function parseHdfcUpi(raw: string): NarrationExtraction {
  const body = raw.replace(/^UPI[-\/ ]/i, "");
  const vpaMatch = body.match(VPA_RE);
  if (!vpaMatch || vpaMatch.index === undefined) {
    return { ...EMPTY, channel: "upi" };
  }
  const vpa = vpaMatch[0].toLowerCase();
  const counterparty = cleanSegment(body.slice(0, vpaMatch.index));
  const afterVpa = body.slice(vpaMatch.index + vpaMatch[0].length);

  // RRN = first 10-14 digit run after the VPA
  const rrnMatch = afterVpa.match(/(\d{10,14})/);
  const rrn = rrnMatch ? rrnMatch[1].replace(/^0+/, "") : null;

  let ifsc: string | null = null;
  let upiNote: string | null = null;
  if (rrnMatch && rrnMatch.index !== undefined) {
    const between = cleanSegment(afterVpa.slice(0, rrnMatch.index));
    if (between && IFSC_RE.test(between)) ifsc = between;
    const after = cleanSegment(afterVpa.slice(rrnMatch.index + rrnMatch[1].length));
    // Trailing tail is the user-typed note; drop pure boilerplate like "UPI"
    if (after && !/^UPI$/i.test(after)) upiNote = after;
  }

  return { channel: "upi", counterparty, vpa, rrn, upiNote, ifsc, cardLast4: null };
}

/** NEFT CR-<ifsc>-<sender>-<beneficiary>-<utr> / NEFT DR-... */
function parseHdfcNeft(raw: string): NarrationExtraction {
  const body = raw.replace(/^NEFT\s?(CR|DR)?[- ]/i, "");
  const segments = body.split("-");

  let ifsc: string | null = null;
  let startIdx = 0;
  if (segments[0] && IFSC_RE.test(segments[0].trim())) {
    ifsc = segments[0].trim();
    startIdx = 1;
  }

  // UTR = last segment that looks like a reference (alnum, 6+, contains digits)
  let rrn: string | null = null;
  let endIdx = segments.length;
  const last = segments[segments.length - 1]?.trim();
  if (last && /^[A-Z0-9]{6,}$/i.test(last) && /\d/.test(last)) {
    rrn = last;
    endIdx = segments.length - 1;
  }

  // Middle = sender + beneficiary; the counterparty of interest is the sender
  // for credits (first middle segment). Both names may contain hyphens, so
  // keep it simple: counterparty = first middle segment.
  const middle = segments.slice(startIdx, endIdx);
  const counterparty = cleanSegment(middle[0]);

  return { channel: "neft", counterparty, vpa: null, rrn, upiNote: null, ifsc, cardLast4: null };
}

/** IMPS-<rrn>-<payee>-<bank>-<masked acct>-<note> */
function parseHdfcImps(raw: string): NarrationExtraction {
  const body = raw.replace(/^IMPS[-\/ ]/i, "");
  const segments = body.split("-");
  let rrn: string | null = null;
  let rest = segments;
  if (segments[0] && /^\d{10,14}$/.test(segments[0].trim())) {
    rrn = segments[0].trim();
    rest = segments.slice(1);
  }
  const counterparty = cleanSegment(rest[0]);
  const note = rest.length > 3 ? cleanSegment(rest[rest.length - 1]) : null;
  return { channel: "imps", counterparty, vpa: null, rrn, upiNote: note, ifsc: null, cardLast4: null };
}

/** <acct>-TPT-<remark>-<party>  (party = last segment) */
function parseHdfcTpt(raw: string): NarrationExtraction {
  const m = raw.match(/^(?:\d{10,16}-)?TPT-(.+)$/i);
  if (!m) return { ...EMPTY, channel: "tpt" };
  const segments = m[1].split("-");
  const counterparty = cleanSegment(segments[segments.length - 1]);
  const note = segments.length > 1 ? cleanSegment(segments.slice(0, -1).join("-")) : null;
  return { channel: "tpt", counterparty, vpa: null, rrn: null, upiNote: note, ifsc: null, cardLast4: null };
}

/** POS 4160XXXXXXXX5036 MERCHANT / ME DC SI <card> <merchant> */
function parseHdfcPos(raw: string): NarrationExtraction {
  const m = raw.match(/^(?:POS|ME\s+DC(?:\s+SI)?)\s+(\d{4,6}[X*]{2,10}(\d{4}))\s+(.+)$/i);
  if (!m) {
    const merchant = cleanSegment(raw.replace(/^(?:POS|ME\s+DC(?:\s+SI)?)\s+/i, ""));
    return { ...EMPTY, channel: "pos", counterparty: merchant };
  }
  return {
    channel: "pos",
    counterparty: cleanSegment(m[3]),
    vpa: null,
    rrn: null,
    upiNote: null,
    ifsc: null,
    cardLast4: m[2],
  };
}

const PLUGINS: Record<string, NarrationPlugin> = {
  [genericPlugin.id]: genericPlugin,
  [hdfcPlugin.id]: hdfcPlugin,
};

export function getNarrationPlugin(id: string | null | undefined): NarrationPlugin {
  return (id && PLUGINS[id]) || genericPlugin;
}

export function listNarrationPlugins(): NarrationPlugin[] {
  return Object.values(PLUGINS);
}
