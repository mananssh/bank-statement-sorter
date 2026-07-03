"use server";

import { updateTag } from "next/cache";
import { bootstrapMastersheet } from "@/lib/import/bootstrap-mastersheet";
import { bootstrapInvestments } from "@/lib/import/bootstrap-investments";
import { logError } from "@/lib/security/redact";

export async function bootstrapMastersheetAction(formData: FormData) {
  const file = formData.get("file");
  const accountId = Number(formData.get("account_id"));
  const password = String(formData.get("password") ?? "") || undefined;
  if (!(file instanceof File) || file.size === 0 || !accountId) {
    return { ok: false as const, error: "Choose a workbook and an account." };
  }
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await bootstrapMastersheet(buffer, file.name, accountId, password);
    updateTag("txns");
    updateTag("lookups");
    return {
      ok: true as const,
      message: `Imported ${result.transactions} transactions (${result.duplicates} duplicates skipped), ${result.categories} new categories, months: ${result.monthsFound.join(", ") || "none found"}.`,
    };
  } catch (e) {
    logError("bootstrap", e);
    return {
      ok: false as const,
      error:
        "Could not read that workbook — is it the FY mastersheet format (Setup / Party_Master / month tabs)? If it's password-protected, enter the password.",
    };
  }
}

export async function bootstrapInvestmentsAction(formData: FormData) {
  const file = formData.get("file");
  const password = String(formData.get("password") ?? "") || undefined;
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false as const, error: "Choose a workbook." };
  }
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await bootstrapInvestments(buffer, password);
    updateTag("investments");
    return {
      ok: true as const,
      message: `Imported ${result.funds} funds, ${result.txns} investment transactions, ${result.goals} goals.`,
    };
  } catch (e) {
    logError("bootstrap", e);
    return {
      ok: false as const,
      error:
        "Could not read that workbook — is it the investments format (Fund_Master / Investment_Log / Party_Allocator)?",
    };
  }
}
