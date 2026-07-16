import { NextResponse, type NextRequest } from "next/server";
import { buildInvestmentsSheet } from "@/lib/export/investments-sheet";

/** GET /api/export/investments?fy=2026 — omit fy (or fy=all) for full history. */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("fy");
  let fy: number | null = null;
  if (raw && raw !== "all") {
    fy = Number(raw);
    if (!Number.isInteger(fy) || fy < 1990 || fy > 2100) {
      return new NextResponse("Invalid FY", { status: 400 });
    }
  }
  const { buffer, fileName } = await buildInvestmentsSheet(fy);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
