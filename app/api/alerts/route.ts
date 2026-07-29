import { desc, eq } from "drizzle-orm";
import { ensureSchema, getDb } from "../../../db";
import { alertRules } from "../../../db/schema";
import { isStockCode, toCents } from "../../../lib/domain";

const alertTypes = new Set(["止损", "止盈一", "止盈二"]);

export async function GET() {
  try {
    await ensureSchema();
    const alerts = await getDb().select().from(alertRules).orderBy(desc(alertRules.id));
    return Response.json({ alerts });
  } catch {
    return Response.json({ error: "提醒暂时无法读取" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { symbol?: string; name?: string; type?: string; targetPrice?: number };
    const symbol = payload.symbol?.trim() ?? "";
    const name = payload.name?.trim() ?? "";
    const type = payload.type?.trim() ?? "";
    const rawTargetPrice = Number(payload.targetPrice);
    const targetPriceCents = toCents(rawTargetPrice);
    if (!isStockCode(symbol) || !name || !alertTypes.has(type) || !Number.isFinite(rawTargetPrice) || targetPriceCents <= 0) {
      return Response.json({ error: "提醒信息不正确" }, { status: 400 });
    }
    await ensureSchema();
    const [alert] = await getDb().insert(alertRules).values({
      symbol,
      name,
      type: type as "止损" | "止盈一" | "止盈二",
      targetPriceCents,
    }).returning();
    return Response.json({ alert }, { status: 201 });
  } catch {
    return Response.json({ error: "提醒保存失败" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = await request.json() as { id?: number; action?: string };
    const id = Number(payload.id);
    if (!Number.isInteger(id) || id <= 0) {
      return Response.json({ error: "提醒编号不正确" }, { status: 400 });
    }
    if (payload.action !== "disable" && payload.action !== "acknowledge") {
      return Response.json({ error: "提醒操作不正确" }, { status: 400 });
    }
    await ensureSchema();
    const values = payload.action === "disable"
      ? { enabled: false }
      : { acknowledgedAt: new Date().toISOString() };
    const [alert] = await getDb().update(alertRules).set(values).where(eq(alertRules.id, id)).returning();
    return alert
      ? Response.json({ alert })
      : Response.json({ error: "提醒不存在" }, { status: 404 });
  } catch {
    return Response.json({ error: "提醒更新失败" }, { status: 500 });
  }
}
