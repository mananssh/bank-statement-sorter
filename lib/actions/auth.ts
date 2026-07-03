"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  clearPassphrase,
  mintSessionCookie,
  passphraseIsSet,
  setPassphrase,
  verifyPassphrase,
} from "@/lib/security/session";

async function setSessionCookie() {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, mintSessionCookie(), {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function unlockAction(formData: FormData) {
  const passphrase = String(formData.get("passphrase") ?? "");
  if (!verifyPassphrase(passphrase)) {
    return { ok: false as const, error: "Wrong passphrase." };
  }
  await setSessionCookie();
  redirect("/dashboard");
}

export async function setPassphraseAction(formData: FormData) {
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  if (passphraseIsSet() && !verifyPassphrase(current)) {
    return { ok: false as const, error: "Current passphrase is wrong." };
  }
  if (next.length < 6) {
    return { ok: false as const, error: "Use at least 6 characters." };
  }
  setPassphrase(next);
  await setSessionCookie();
  return { ok: true as const };
}

export async function clearPassphraseAction(formData: FormData) {
  const current = String(formData.get("current") ?? "");
  if (!verifyPassphrase(current)) {
    return { ok: false as const, error: "Current passphrase is wrong." };
  }
  clearPassphrase();
  return { ok: true as const };
}

export async function lockNowAction() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  redirect("/unlock");
}
