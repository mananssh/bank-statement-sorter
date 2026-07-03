import { Suspense } from "react";
import { connection } from "next/server";
import { dataDir, dbPath } from "@/lib/config";
import { getSetting } from "@/lib/repos/settings";
import { passphraseIsSet } from "@/lib/security/session";
import { GeneralSettingsForm, PassphraseForm } from "@/components/settings/settings-forms";
import { BootstrapForms } from "@/components/settings/bootstrap-forms";
import { BackupManager } from "@/components/settings/backup-manager";
import { listBackups } from "@/lib/db/autosave";
import { pendingRestore } from "@/lib/db/restore";
import { listAccounts } from "@/lib/repos/lookups";
import { Card, CardTitle } from "@/components/ui";

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-lg font-semibold">Settings</h1>
      <Suspense>
        <Content />
      </Suspense>
    </div>
  );
}

async function Content() {
  await connection();
  return (
    <>
      <GeneralSettingsForm
        fyStartMonth={getSetting<number>("fy_start_month", 4)}
        currency={getSetting<string>("currency", "INR")}
      />
      <PassphraseForm isSet={passphraseIsSet()} />
      <BootstrapForms accounts={listAccounts()} />
      <BackupManager backups={listBackups()} hasPendingRestore={pendingRestore()} />
      <Card>
        <CardTitle>Data & privacy</CardTitle>
        <dl className="space-y-1.5 text-sm">
          <Row label="Database" value={dbPath()} />
          <Row label="Data directory" value={dataDir()} />
          <Row label="Network" value="Serves localhost only; zero external calls." />
          <Row
            label="Off-machine backup"
            value="Download a consistent DB snapshot (VACUUM INTO) to store anywhere you like."
          />
        </dl>
        <a
          href="/api/backup"
          className="mt-3 inline-block rounded-lg border border-edge px-3 py-1.5 text-sm font-medium text-ink hover:bg-hairline/40"
        >
          Download database backup
        </a>
      </Card>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-32 shrink-0 text-ink-muted">{label}</dt>
      <dd className="break-all font-mono text-xs leading-5 text-ink-secondary">{value}</dd>
    </div>
  );
}
