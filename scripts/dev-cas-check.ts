/**
 * Dev-only, parse-only check of the CAS parsers against a real PDF — no DB,
 * no network, nothing written anywhere (except --dump, see below).
 *
 *   npx tsx scripts/dev-cas-check.ts <cas.pdf> [--password <pw>] [--verbose] [--dump <file>]
 *
 * Prints detected kind + parsed structure (scheme/holding names, counts,
 * unit balances). --verbose adds every parsed transaction/holding row.
 * --dump writes the raw extracted text lines to a file for parser debugging —
 * that dump contains the statement's personal data, so keep it out of the repo.
 */
import fs from "node:fs";
import { extractPdfLines, PdfPasswordError } from "@/lib/parsers/cas/pdf-text";
import { detectCasKind } from "@/lib/parsers/cas/detect";
import { parseCamsCas } from "@/lib/parsers/cas/cams";
import { parseNsdlCas } from "@/lib/parsers/cas/nsdl";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const file = process.argv[2];
  if (!file || file.startsWith("--")) {
    console.error(
      "usage: npx tsx scripts/dev-cas-check.ts <cas.pdf> [--password <pw>] [--verbose] [--dump <file>]",
    );
    process.exit(1);
  }
  const password = arg("--password");
  const verbose = process.argv.includes("--verbose");
  const dump = arg("--dump");

  let pages: string[][];
  try {
    pages = await extractPdfLines(fs.readFileSync(file), password);
  } catch (err) {
    if (err instanceof PdfPasswordError) {
      console.error(`✗ ${err.message} (pass it with --password)`);
      process.exit(1);
    }
    throw err;
  }
  console.log(`pages: ${pages.length}, lines: ${pages.flat().length}`);

  if (dump) {
    fs.writeFileSync(dump, pages.map((p, i) => `--- page ${i + 1} ---\n${p.join("\n")}`).join("\n\n"));
    console.log(`raw lines dumped to ${dump} (contains personal data — do not commit)`);
  }

  const kind = detectCasKind(pages);
  console.log(`detected: ${kind ?? "UNKNOWN — not a recognized CAS layout"}\n`);
  if (!kind) process.exit(2);

  if (kind === "cams") {
    const cas = parseCamsCas(pages);
    console.log(`period: ${cas.period_from ?? "?"} → ${cas.period_to ?? "?"}`);
    console.log(`schemes: ${cas.schemes.length}\n`);
    for (const s of cas.schemes) {
      console.log(`● ${s.name}`);
      console.log(
        `    isin=${s.isin ?? "—"} folio=${s.folio ?? "—"} rta=${s.rta ?? "—"} ` +
          `txns=${s.txns.length} charges_skipped=${s.charges_skipped}`,
      );
      console.log(
        `    units: open=${s.opening_units ?? "—"} close=${s.closing_units ?? "—"} ` +
          `nav=${s.closing_nav ?? "—"} (${s.closing_nav_date ?? "—"})`,
      );
      if (verbose) {
        for (const t of s.txns) {
          console.log(
            `      ${t.date} [${t.type}] ₹${(t.amount_paise / 100).toFixed(2)} ` +
              `units=${t.units ?? "—"} nav=${t.nav ?? "—"} — ${t.description}`,
          );
        }
      }
      // Sanity: do parsed txns walk opening → closing units?
      if (s.opening_units !== null && s.closing_units !== null) {
        const walked = s.txns.reduce(
          (u, t) => u + (t.units === null ? 0 : t.type === "sell" ? -Math.abs(t.units) : Math.abs(t.units)),
          s.opening_units,
        );
        const ok = Math.abs(walked - s.closing_units) < 0.01;
        console.log(`    unit walk: ${ok ? "✓" : `✗ expected ${s.closing_units}, walked ${walked.toFixed(4)}`}`);
      }
    }
  } else {
    const cas = parseNsdlCas(pages);
    console.log(`statement date: ${cas.statement_date ?? "?"}`);
    console.log(`holdings: ${cas.holdings.length}\n`);
    for (const h of cas.holdings) {
      console.log(`● [${h.kind}] ${h.name || "(no name parsed)"}${h.symbol ? ` (${h.symbol})` : ""}`);
      console.log(
        `    isin=${h.isin} units=${h.units ?? "—"} price=${h.price ?? "—"} ` +
          `value=${h.value_paise !== null ? `₹${(h.value_paise / 100).toFixed(2)}` : "—"}`,
      );
    }
    if (verbose) {
      const missing = cas.holdings.filter((h) => h.units === null || h.value_paise === null);
      if (missing.length) {
        console.log(`\n${missing.length} holding(s) parsed incompletely — check --dump output.`);
      }
    }
  }
}

main();
