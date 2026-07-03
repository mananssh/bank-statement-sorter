import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

/**
 * Optional app passphrase. The scrypt hash lives in a FILE under DATA_DIR
 * (not the DB) so the proxy gate can check it without pulling native modules
 * into the proxy runtime. No file = no passphrase = gate is a no-op.
 *
 * Session cookie format: "<expiryEpochMs>.<hmacSha256(expiry, secret)>".
 */

export const SESSION_COOKIE = "ss_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

// Duplicated from lib/config to keep this module dependency-free for proxy.
function dataDir(): string {
  return process.env.DATA_DIR?.trim() || path.join(process.cwd(), "data");
}

function passphrasePath(): string {
  return path.join(dataDir(), "passphrase");
}

function secretPath(): string {
  return path.join(dataDir(), "session-secret");
}

export function passphraseIsSet(): boolean {
  try {
    return fs.existsSync(passphrasePath());
  } catch {
    return false;
  }
}

export function setPassphrase(passphrase: string): void {
  const salt = crypto.randomBytes(32);
  const hash = crypto.scryptSync(passphrase, salt, 32, { N: 2 ** 15, r: 8, p: 1 });
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(passphrasePath(), `${salt.toString("hex")}:${hash.toString("hex")}`, {
    mode: 0o600,
  });
}

export function clearPassphrase(): void {
  try {
    fs.rmSync(passphrasePath(), { force: true });
  } catch {
    // already gone
  }
}

export function verifyPassphrase(passphrase: string): boolean {
  let stored: string;
  try {
    stored = fs.readFileSync(passphrasePath(), "utf8").trim();
  } catch {
    return false;
  }
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const computed = crypto.scryptSync(passphrase, Buffer.from(saltHex, "hex"), 32, {
    N: 2 ** 15,
    r: 8,
    p: 1,
  });
  const expected = Buffer.from(hashHex, "hex");
  return computed.length === expected.length && crypto.timingSafeEqual(computed, expected);
}

function sessionSecret(): Buffer {
  const p = secretPath();
  try {
    const existing = fs.readFileSync(p);
    if (existing.length >= 32) return existing;
  } catch {
    // fall through to create
  }
  const secret = crypto.randomBytes(32);
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(p, secret, { mode: 0o600 });
  return secret;
}

export function mintSessionCookie(now = Date.now()): string {
  const expiry = String(now + SESSION_TTL_MS);
  const mac = crypto.createHmac("sha256", sessionSecret()).update(expiry).digest("hex");
  return `${expiry}.${mac}`;
}

export function verifySessionCookie(value: string | undefined, now = Date.now()): boolean {
  if (!value) return false;
  const dot = value.indexOf(".");
  if (dot <= 0) return false;
  const expiry = value.slice(0, dot);
  const mac = value.slice(dot + 1);
  if (!/^\d{10,16}$/.test(expiry) || Number(expiry) < now) return false;
  const expected = crypto.createHmac("sha256", sessionSecret()).update(expiry).digest("hex");
  const a = Buffer.from(mac, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
