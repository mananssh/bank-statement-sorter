"use server";

import { revalidatePath } from "next/cache";
import { updateTag } from "next/cache";
import { z } from "zod";
import { setSetting } from "@/lib/repos/settings";
import { takeSnapshot } from "@/lib/db/autosave";
import { cancelRestore, requestRestore } from "@/lib/db/restore";
import { logError } from "@/lib/security/redact";

const schema = z.object({
  fy_start_month: z.coerce.number().int().min(1).max(12),
  currency: z.string().min(1).max(8),
});

export async function updateSettingsAction(formData: FormData) {
  const parsed = schema.safeParse({
    fy_start_month: formData.get("fy_start_month"),
    currency: formData.get("currency"),
  });
  if (!parsed.success) return { ok: false as const, error: "Invalid settings." };
  setSetting("fy_start_month", parsed.data.fy_start_month);
  setSetting("currency", parsed.data.currency);
  updateTag("lookups");
  updateTag("txns");
  return { ok: true as const };
}

export async function snapshotNowAction() {
  try {
    takeSnapshot("manual");
    revalidatePath("/settings");
    return { ok: true as const };
  } catch (e) {
    logError("autosave", e);
    return { ok: false as const, error: "Snapshot failed." };
  }
}

export async function restoreBackupAction(name: string) {
  try {
    requestRestore(name);
    revalidatePath("/settings");
    return { ok: true as const };
  } catch (e) {
    logError("autosave", e);
    return { ok: false as const, error: "Could not stage that backup for restore." };
  }
}

export async function cancelRestoreAction() {
  cancelRestore();
  revalidatePath("/settings");
  return { ok: true as const };
}
