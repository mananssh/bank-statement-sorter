import { NextResponse, type NextRequest } from "next/server";
import { buildFyWorkbook } from "@/lib/export/fy-workbook";
import { fyLabel } from "@/lib/domain/fy";
import { fyStartMonth } from "@/lib/repos/settings";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/export/fy/[fy]">) {
  const { fy } = await ctx.params;
  const year = Number(fy);
  if (!Number.isInteger(year) || year < 1990 || year > 2100) {
    return new NextResponse("Invalid FY", { status: 400 });
  }
  const buffer = await buildFyWorkbook(year);
  const label = fyLabel(year, fyStartMonth());
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${label}.xlsx"`,
    },
  });
}
