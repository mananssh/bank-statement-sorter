import { NextResponse, type NextRequest } from "next/server";
import { buildStatementSheet } from "@/lib/export/statement-sheet";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/export/statement/[id]">) {
  const { id } = await ctx.params;
  const statementId = Number(id);
  if (!Number.isInteger(statementId)) return new NextResponse("Invalid id", { status: 400 });
  const result = await buildStatementSheet(statementId);
  if (!result) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(result.buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${result.fileName}"`,
    },
  });
}
