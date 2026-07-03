import { Suspense } from "react";
import { connection } from "next/server";
import { accountBalances } from "@/lib/repos/reports";
import { AccountManager } from "@/components/accounts/account-manager";

export default function AccountsPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Accounts</h1>
        <p className="text-sm text-ink-secondary">
          Your bank accounts, cards, and investment platforms — statements import into these.
        </p>
      </div>
      <Suspense>
        <Content />
      </Suspense>
    </div>
  );
}

async function Content() {
  await connection();
  return <AccountManager balances={accountBalances()} />;
}
