"use server";

import { updateTag } from "next/cache";
import { extractPdfLines, PdfPasswordError } from "@/lib/parsers/cas/pdf-text";
import { detectCasKind } from "@/lib/parsers/cas/detect";
import { parseCamsCas } from "@/lib/parsers/cas/cams";
import { parseNsdlCas } from "@/lib/parsers/cas/nsdl";
import { importCamsCas, importNsdlCas } from "@/lib/import/cas";

/**
 * CAS PDF import from the UI. Same pipeline as scripts/cas-import.ts; the
 * password is used in memory for this one request and never stored or logged.
 */

export interface CasImportState {
  ok: boolean;
  summary: string;
  warnings: string[];
}

export async function importCasAction(
  _prev: CasImportState | null,
  formData: FormData,
): Promise<CasImportState> {
  const file = formData.get("file");
  const password = String(formData.get("password") ?? "") || undefined;
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, summary: "Choose a CAS PDF first.", warnings: [] };
  }
  const data = new Uint8Array(await file.arrayBuffer());
  if (String.fromCharCode(...data.slice(0, 5)) !== "%PDF-") {
    return { ok: false, summary: `${file.name} is not a PDF.`, warnings: [] };
  }

  let pages: string[][];
  try {
    pages = await extractPdfLines(data, password);
  } catch (err) {
    return {
      ok: false,
      summary:
        err instanceof PdfPasswordError
          ? "The PDF is password-protected — the password is missing or wrong."
          : `Could not read the PDF${err instanceof Error ? ` — ${err.message}` : ""}.`,
      warnings: [],
    };
  }

  const kind = detectCasKind(pages);
  if (kind === "cams") {
    const cas = parseCamsCas(pages);
    if (cas.schemes.length === 0) {
      return {
        ok: false,
        summary: "Detected a CAMS CAS but parsed 0 schemes — is this the Detailed statement?",
        warnings: [],
      };
    }
    const r = importCamsCas(cas);
    updateTag("investments");
    return {
      ok: true,
      summary:
        `CAMS detailed CAS ${cas.period_from ?? "?"} → ${cas.period_to ?? "?"}: ` +
        `${r.inserted} transaction(s) imported, ${r.skipped_duplicates} duplicate(s) skipped, ` +
        `${r.instruments_created} instrument(s) created.`,
      warnings: [
        ...r.unparsed_schemes.map((s) => `Unparsed scheme: ${s}`),
        ...r.missing_history.map(
          (m) =>
            `${m.name}: opens at ${m.opening_units} unit(s) with no history here — ` +
            `import a since-inception detailed CAS once to backfill.`,
        ),
      ],
    };
  }

  if (kind === "nsdl") {
    const cas = parseNsdlCas(pages);
    if (cas.holdings.length === 0) {
      return { ok: false, summary: "Detected an e-CAS but parsed 0 holdings.", warnings: [] };
    }
    const r = importNsdlCas(cas);
    updateTag("investments");
    return {
      ok: true,
      summary:
        `e-CAS as on ${cas.statement_date ?? "?"}: ${r.holdings} holding(s), ` +
        `${r.navs_updated} price(s) recorded, ${r.observed_positions} observed position(s), ` +
        `${r.instruments_created} instrument(s) created.`,
      warnings: [
        ...r.mismatches.map(
          (m) =>
            `Units mismatch — ${m.name}: statement says ${m.cas_units}, ` +
            `app has ${Number(m.app_units.toFixed(4))} as of the statement date.`,
        ),
        ...(r.mf_without_txns.length
          ? [
              `MF folio(s) with no transactions yet (import a CAMS detailed CAS to backfill): ` +
                r.mf_without_txns.join("; "),
            ]
          : []),
      ],
    };
  }

  return {
    ok: false,
    summary:
      "Not a recognized CAS layout. Supported: CAMS/KFintech detailed CAS and NSDL/CDSL e-CAS.",
    warnings: [],
  };
}
