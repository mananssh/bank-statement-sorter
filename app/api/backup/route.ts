import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { connection } from "next/server";
import { db } from "@/lib/db/client";
import { backupsDir } from "@/lib/config";

/** Consistent snapshot via VACUUM INTO (safe under WAL); also kept on disk. */
export async function GET() {
  await connection(); // request-time only — never during build prerender
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const file = path.join(backupsDir(), `statement-sorter-${stamp}.db`);
  db().exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const buffer = fs.readFileSync(file);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${path.basename(file)}"`,
    },
  });
}
