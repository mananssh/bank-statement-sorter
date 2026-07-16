# statement·sorter

**Local-first personal finance management.** Import bank / credit-card / mutual-fund
statements from any institution, auto-categorize transactions with an engine that
learns from your corrections, and get dashboards, FY reports, and clean Excel
exports — all on your machine, with zero external calls.

> Your financial data never leaves your computer. The app binds to `127.0.0.1`,
> makes no network requests, and stores everything in a local SQLite file you own.

## Highlights

- **Import anything** — `.xlsx`, legacy `.xls` (BIFF8), `.csv`. Password-protected
  workbooks are decrypted in memory (the password is never stored). A click-the-header
  mapping UI handles any bank's layout and saves it as a **preset**, auto-matched by
  header fingerprint on every future import.
- **Auto-categorization that learns** — layered resolver: learned payee memory →
  party default category → your rules (with test-against-history dry runs) → shipped
  heuristics. Confirming or correcting a suggestion during review teaches it; one
  correction wins from the next import onwards. Verified at **99% auto-tag coverage**
  on a year of real HDFC data after bootstrapping.
- **Narration mining** — UPI/NEFT/IMPS/POS/TPT structures inside bank narrations are
  parsed into counterparty, VPA, RRN/UTR, IFSC — including the **user-typed UPI note**,
  which pre-fills the transaction description.
- **Bulletproof dedup** — whole-file SHA-256 short-circuit plus a per-row hash that is
  stable across overlapping statement periods and even across different files
  containing the same transactions.
- **Two-entity taxonomy** — every transaction gets an **Account (Category)** (ledger
  bucket, like Zoho Books' "Account") and a **Party** (the actual counterparty),
  auto-created from narrations with alias merging.
- **Transfer detection** — CC bill payments and self-transfers are paired across
  accounts and excluded from income/expense so nothing double-counts.
- **Dashboard & FY view** — KPIs (income, expenses, invested, net flow, savings rate),
  monthly cashflow chart, category donut + breakdown table, recurring-payment
  (subscription) detection, untagged call-to-action, financial-year ledger with
  month chips. FY start month is configurable (April for India, January for
  calendar-year countries).
- **Investments** — fund holdings with manual NAV valuation and P&L, monthly SIP
  budget progress, 80C/ELSS headroom tracker, goal buckets, fixed deposits.
- **CAS import** — feed it your CAMS/KFintech **detailed CAS** (full MF
  transaction history, broker-independent) and NSDL/CDSL **e-CAS** (demat
  stock/ETF positions + MF units cross-check) PDFs. Parsed fully locally
  (password stays in memory); headless CLI for scheduled automation:
  `NODE_OPTIONS=--conditions=react-server npx tsx scripts/cas-import.ts <cas.pdf> --password <pw>`
- **Invoices** — multi-currency register; sent invoices auto-suggest matching
  incoming bank credits for one-click paid-linking.
- **Excel round-trip** — one-click export of a clean, pivot-ready **FY workbook**
  (Summary / Transactions / Categories / Parties / Investments / Holdings / Goals /
  FDs / Invoices — every sheet a real Excel table), plus **enriched per-statement
  sheets** (original columns + Account Name / Party Name / Description). One-time
  **bootstrap importers** migrate existing mastersheet-style and investment-log
  workbooks, including their manual tagging history.

## Quick start

```bash
npm install
npm run dev        # binds to http://127.0.0.1:3000
```

First run creates the SQLite database with a sensible default category set, seed
categorization rules, and built-in presets (HDFC bank statement, Tata Neu HDFC
credit card `.xls`, mutual-fund order book).

Typical loop:

1. **Accounts** → add your bank account / credit card (last-4 digits only).
2. **Import** → drop a statement. First time: click the header row, map columns,
   save the preset. Every time after: it just parses.
3. **Review** → untagged rows are highlighted; fix them (bulk "apply to same payee"
   helps), commit. The engine learns from everything you confirm.
4. **Dashboard / FY** → watch the year assemble itself. Export the FY workbook
   whenever you want an Excel copy.

Migrating from spreadsheets? **Settings → Migrate from Excel** imports an existing
FY mastersheet (categories + transactions + tag history) and an investments workbook
(funds, SIP log, goals) in one shot.

## Security & privacy model

| Layer | What it does |
|---|---|
| Localhost bind | `next dev/start -H 127.0.0.1`; nothing is reachable from your network |
| Host allowlist (`proxy.ts`) | Rejects non-localhost `Host` headers → blocks DNS-rebinding |
| Zero egress by default | No fetches to any external service, telemetry disabled. One opt-in exception: the AMFI NAV fetch (Settings toggle, off by default) — a single GET to amfiindia.com's public NAV file, sending nothing about you |
| Optional passphrase | scrypt-hashed, HMAC session cookie (12h); enable in Settings |
| Excel/PDF passwords | Used once, in memory, to decrypt an import (workbooks, CAS PDFs) — never persisted or logged |
| Data at rest | Plain SQLite under `DATA_DIR` (gitignored); pair with OS disk encryption (BitLocker/FileVault) |
| Log hygiene | Anything logged is redacted (digit runs, VPAs); raw failed rows stay inside the DB |
| Numbers | Only last-4 digits of account/card numbers are ever stored |
| Backups | Continuous: WAL checkpoint every minute + rotating snapshots in `data/backups/` every 5 minutes (and at boot/shutdown); restore from Settings. Manual off-machine download too |

## Configuration

Copy `.env.example` → `.env.local`:

- `DATA_DIR` — where the SQLite DB, session secret, and backups live
  (default `<project>/data`). Point it at a folder your backups cover.
- FY start month & currency are in **Settings** (stored in the DB).

## Architecture (for contributors)

Next.js 16 (App Router, **Cache Components enabled** — everything dynamic by
default, `use cache`/`updateTag` for caching), React 19, Tailwind v4 (CSS-first
tokens, class-strategy dark mode), better-sqlite3 (STRICT tables, WAL,
migrate-on-open), SheetJS for reading workbooks / exceljs for writing them.

```
lib/
  db/          schema (migrations/*.sql), client singleton, row types
  domain/      money (integer paise), FY helpers, dedup hashing
  normalize/   date coercion, amount styles, narration mining (plugin registry)
  parsers/     workbook opening, decryption, header detection/fingerprints,
               generic grid→canonical parsing, built-in presets
  categorize/  payee keys, layered resolver, seeds, learning, transfer linking
  import/      wizard orchestration (staging tables), bootstrap importers
  repos/       prepared-statement data access + reporting SQL
  actions/     'use server' mutations
  export/      FY workbook + enriched statement writers
  security/    session (scrypt+HMAC), log redaction
app/           routes (server components + client islands)
components/    UI primitives on the token layer, feature components
```

**Generalization principle:** nothing institution-specific lives in core logic.
Institutions plug in via import presets (data) and narration parser plugins
(`lib/normalize/narration.ts`). To support a new bank's narration format, add a
plugin and register it — imports already work without one via the generic parser.

Dev checks against real files (never committed):

```bash
npx tsx scripts/dev-parse-check.ts <statement.xlsx>          # parsing stats
npx tsx scripts/dev-cas-check.ts <cas.pdf> --password <pw>   # CAS parse (no DB)
DATA_DIR=/tmp/e2e NODE_OPTIONS=--conditions=react-server \
  npx tsx scripts/dev-e2e-check.ts <mastersheet> <statement> <sheet>  # full pipeline
```

## Roadmap

- Inbox folder scan (“drop files here, import everything that matches a preset”)
- CAS PDF upload in the Import UI (the headless CLI exists today)
- PDF ingestion (FD advices, receipts), invoice PDF generation
- Zoho Books-compatible CSV export, preset sharing as JSON
- SQLCipher opt-in for at-rest encryption

## License

MIT
