import "server-only";

/**
 * Excel "Encrypt with Password" produces an OLE compound file wrapping an
 * EncryptedPackage stream. Detection = CFB magic bytes; SheetJS cannot open
 * these, so we decrypt to a plain buffer in memory first. The password lives
 * only in the calling scope — never persisted, never logged.
 */

const CFB_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

export function isCfbContainer(buffer: Buffer): boolean {
  return buffer.length >= 8 && buffer.subarray(0, 8).equals(CFB_MAGIC);
}

/**
 * True for password-encrypted OOXML. Legacy BIFF .xls files are ALSO CFB
 * containers but contain a "Workbook" stream instead of "EncryptedPackage";
 * a cheap string probe distinguishes them without a full CFB parse.
 */
export function isEncryptedWorkbook(buffer: Buffer): boolean {
  if (!isCfbContainer(buffer)) return false;
  const probe = buffer.subarray(0, Math.min(buffer.length, 8192)).toString("latin1");
  const asUtf16 = utf16Probe(buffer);
  return probe.includes("EncryptedPackage") || asUtf16.includes("EncryptedPackage");
}

function utf16Probe(buffer: Buffer): string {
  const end = Math.min(buffer.length, 16384);
  let s = "";
  for (let i = 0; i < end - 1; i += 2) {
    const code = buffer.readUInt16LE(i);
    if (code >= 32 && code < 127) s += String.fromCharCode(code);
  }
  return s;
}

export async function decryptWorkbook(buffer: Buffer, password: string): Promise<Buffer> {
  const { decrypt } = await import("officecrypto-tool");
  return decrypt(buffer, { password });
}
