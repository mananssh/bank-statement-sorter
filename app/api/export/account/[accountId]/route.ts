import { NextResponse, type NextRequest } from "next/server";
import { buildAccountStatementSheet } from "@/lib/export/account-statement";

/** GET /api/export/account/:accountId?fy=2026 — omit fy (or fy=all) for full history. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/export/account/[accountId]">) {
  const { accountId } = await ctx.params;
  const id = Number(accountId);
  if (!Number.isInteger(id)) return new NextResponse("Invalid account id", { status: 400 });

  const raw = req.nextUrl.searchParams.get("fy");
  let fy: number | null = null;
  if (raw && raw !== "all") {
    fy = Number(raw);
    if (!Number.isInteger(fy) || fy < 1990 || fy > 2100) {
      return new NextResponse("Invalid FY", { status: 400 });
    }
  }

  const result = await buildAccountStatementSheet(id, fy);
  if (!result) return new NextResponse("Account not found", { status: 404 });
  return new NextResponse(new Uint8Array(result.buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${result.fileName}"`,
    },
  });
}
