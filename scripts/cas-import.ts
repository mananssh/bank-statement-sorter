/**
 * Headless CAS import — made for scheduled automation: point it at CAMS
 * detailed CAS and/or NSDL/CDSL e-CAS PDFs and it imports them into the app
 * DB (document kind auto-detected per file). Everything stays local; the PDF
 * password is used in memory only and never stored or logged.
 *
 *   $env:NODE_OPTIONS='--conditions=react-server'          # PowerShell
 *   npx tsx scripts/cas-import.ts <cas1.pdf> [cas2.pdf ...] [--password <pw>]
 *
 * (bash: NODE_OPTIONS=--conditions=react-server npx tsx scripts/cas-import.ts ...)
 *
 * One --password applies to all files that need one (CAMS mailback PDFs and
 * NSDL e-CAS commonly share the PAN-derived password scheme). Exit code 0 =
 * all files imported; 1 = at least one failed (details on stderr).
 */
import fs from "node:fs";
import { extractPdfLines, PdfPasswordError } from "@/lib/parsers/cas/pdf-text";
import { detectCasKind } from "@/lib/parsers/cas/detect";
import { parseCamsCas } from "@/lib/parsers/cas/cams";
import { parseNsdlCas } from "@/lib/parsers/cas/nsdl";
import { importCamsCas, importNsdlCas } from "@/lib/import/cas";

function parseArgs(): { files: string[]; password?: string } {
  const argv = process.argv.slice(2);
  const files: string[] = [];
  let password: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--password") password = argv[++i];
    else files.push(argv[i]);
  }
  return { files, password };
}

async function importOne(file: string, password?: string): Promise<boolean> {
  const name = file.split(/[\\/]/).pop();
  let pages: string[][];
  try {
    pages = await extractPdfLines(fs.readFileSync(file), password);
  } catch (err) {
    console.error(
      `✗ ${name}: ${err instanceof PdfPasswordError ? err.message : err instanceof Error ? err.message : err}`,
    );
    return false;
  }

  const kind = detectCasKind(pages);
  if (!kind) {
    console.error(`✗ ${name}: not a recognized CAS layout (run scripts/dev-cas-check.ts --dump)`);
    return false;
  }

  if (kind === "cams") {
    const cas = parseCamsCas(pages);
    if (cas.schemes.length === 0) {
      console.error(`✗ ${name}: detected CAMS CAS but parsed 0 schemes — layout drift? (dev-cas-check --dump)`);
      return false;
    }
    const r = importCamsCas(cas);
    console.log(
      `✓ ${name} [CAMS ${cas.period_from ?? "?"} → ${cas.period_to ?? "?"}]: ` +
        `${r.inserted} txn(s) imported, ${r.skipped_duplicates} duplicate(s) skipped, ` +
        `${r.instruments_created} instrument(s) created across ${r.schemes} scheme(s)` +
        (r.charges_skipped ? `, ${r.charges_skipped} charge row(s) ignored` : ""),
    );
    if (r.unparsed_schemes.length) {
      console.error(`  ⚠ unparsed schemes: ${r.unparsed_schemes.join("; ")}`);
    }
    for (const m of r.missing_history) {
      console.error(
        `  ⚠ ${m.name}: statement opens at ${m.opening_units} unit(s) with no history in the app — ` +
          `request a since-inception detailed CAS once to backfill`,
      );
    }
    return true;
  }

  const cas = parseNsdlCas(pages);
  if (cas.holdings.length === 0) {
    console.error(`✗ ${name}: detected e-CAS but parsed 0 holdings — layout drift? (dev-cas-check --dump)`);
    return false;
  }
  const r = importNsdlCas(cas);
  console.log(
    `✓ ${name} [e-CAS as on ${cas.statement_date ?? "?"}]: ${r.holdings} holding(s), ` +
      `${r.navs_updated} price(s) recorded, ${r.observed_positions} observed position(s), ` +
      `${r.instruments_created} instrument(s) created`,
  );
  for (const m of r.mismatches) {
    console.error(
      `  ⚠ units mismatch — ${m.name}: statement says ${m.cas_units}, app has ${Number(m.app_units.toFixed(4))}`,
    );
  }
  if (r.mf_without_txns.length) {
    console.error(
      `  ℹ MF folio(s) with no transactions in the app yet (import a CAMS detailed CAS to backfill): ` +
        r.mf_without_txns.join("; "),
    );
  }
  return true;
}

async function main() {
  const { files, password } = parseArgs();
  if (files.length === 0) {
    console.error("usage: npx tsx scripts/cas-import.ts <cas.pdf> [more.pdf ...] [--password <pw>]");
    process.exit(1);
  }
  let ok = true;
  for (const f of files) ok = (await importOne(f, password)) && ok;
  process.exit(ok ? 0 : 1);
}

main();
