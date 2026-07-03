"use server";

import { updateTag } from "next/cache";
import { z } from "zod";
import { setSetting } from "@/lib/repos/settings";

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
