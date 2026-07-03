<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project conventions (statement-sorter)

Local-first personal finance web app. **Generalized OSS** — nothing
institution-specific in core logic; banks plug in via import presets (data rows)
and narration plugins (`lib/normalize/narration.ts`). See README for architecture.

## Next.js 16 rules used throughout this repo

- `cacheComponents: true` is ON. Every page that touches the DB awaits
  `connection()` (from `next/server`) inside a `<Suspense>` child. **Never await
  `params`/`searchParams` in the page's top-level component** — pass the promises
  into the Suspense child and await there, or the build fails with a
  blocking-route error.
- Mutations are Server Actions in `lib/actions/*.ts` (`"use server"`), validated
  with zod, calling `updateTag(...)` after writes. Downloads are GET route
  handlers under `app/api/`.
- `proxy.ts` (not middleware) enforces localhost-only + the passphrase gate. It
  must stay free of native modules — session code reads files, never the DB.
- Route types are generated: run `npx next typegen` after adding routes; use
  `PageProps<'/route'>` / `RouteContext<'/route'>`.

## Domain invariants

- **Money is integer paise** (minor units) everywhere; dates are ISO
  `YYYY-MM-DD` TEXT. Display via `lib/domain/money.ts`.
- SQLite via the `db()` singleton (`lib/db/client.ts`) only — never open a
  second connection. Schema changes = a new numbered file in
  `lib/db/migrations/`; never edit an applied migration. **Never delete or
  recreate the user's database for a schema change** — user data must survive
  every upgrade (the pre-release 0001-editing era is over). Autosave keeps
  rotating snapshots in `data/backups/` (`lib/db/autosave.ts`, started from
  `instrumentation.ts`); restores are staged via `lib/db/restore.ts` and
  applied by the client before open.
- Dedup: whole-file sha256 on `statements`, row hash via
  `lib/domain/dedup.ts` with `UNIQUE(account_id, dedup_hash, dupe_seq)`.
- Transfers (`is_transfer` / category type `transfer`) are excluded from all
  income/expense aggregates — keep it that way in new reports.
- FY start month is a setting; derive FY with `lib/domain/fy.ts`, never hardcode April.

## Privacy rules (non-negotiable)

- No external network calls. New features needing egress must be opt-in via a
  Settings toggle and documented in the README privacy table.
- Never store full account/card numbers (last-4 only), never persist or log
  workbook passwords, and route any logging through `lib/security/redact.ts`.
- Real statement files live outside the repo; `data/` and `*.db*` are gitignored.
  Dev checks run via `scripts/dev-*-check.ts` against user-supplied paths.

## UI

- Use the semantic tokens in `app/globals.css` (`bg-surface`, `text-ink`,
  `text-credit/debit/investment/transfer`, status tones) — no raw hex in
  components. Dark mode is class-strategy; primitives live in `components/ui`.
- Charts: recharts in client leaf components fed server-computed data; category
  colors come from `lib/ui/colors.ts` (stable per entity, never by rank).
- Money figures get the `tnum` class.

## Workflow

- Work on the `develop` branch; small logical commits (conventional messages),
  push regularly. Keep README/AGENTS.md current when structure changes.
- Verify with `npm run typecheck`, `npm run build` (catches Cache Components
  violations), and the dev check scripts for parser changes.
