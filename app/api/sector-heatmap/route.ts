import { getSectorHeatmap, validateSectorDate } from "../../../lib/sectors";
import { requireApiUser } from "../../../lib/auth";

export async function GET(request: Request) {
  const unauthorized = await requireApiUser();
  if (unauthorized) return unauthorized;

  const date = new URL(request.url).searchParams.get("date")?.trim() ?? "";
  const validationError = validateSectorDate(date);
  if (validationError) {
    return Response.json({ error: validationError }, { status: 400 });
  }

  try {
    const heatmap = await getSectorHeatmap(date);
    const isToday = date === new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
    return Response.json(heatmap, {
      headers: {
        "cache-control": isToday ? "private, max-age=300" : "private, max-age=21600",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "板块异动暂时无法读取";
    return Response.json({ error: message }, { status: 503 });
  }
}
