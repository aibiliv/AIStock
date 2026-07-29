import { desc } from "drizzle-orm";
import { ensureSchema, getDb } from "../../../db";
import { reviews, tradeRecords } from "../../../db/schema";
import { buildTradeCycles, isStockCode } from "../../../lib/domain";
import { requireApiUser } from "../../../lib/auth";

export async function GET() {
  const unauthorized = await requireApiUser();
  if (unauthorized) return unauthorized;
  try {
    await ensureSchema();
    return Response.json({ reviews: await getDb().select().from(reviews).orderBy(desc(reviews.id)) });
  } catch {
    return Response.json({ error: "复盘暂时无法读取" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const unauthorized = await requireApiUser();
  if (unauthorized) return unauthorized;
  try {
    const payload = await request.json() as Record<string, unknown>;
    const symbol = String(payload.symbol ?? "").trim();
    const name = String(payload.name ?? "").trim();
    const buyReason = String(payload.buyReason ?? "").trim();
    const sellReason = String(payload.sellReason ?? "").trim();
    const lesson = String(payload.lesson ?? "").trim();
    const followedPlan = payload.followedPlan === true;
    const cycleEndTradeId = Number(payload.cycleEndTradeId);
    if (!isStockCode(symbol) || !name || !buyReason || !sellReason || !lesson) {
      return Response.json({ error: "请完整填写复盘内容" }, { status: 400 });
    }
    if (!Number.isInteger(cycleEndTradeId) || cycleEndTradeId <= 0) {
      return Response.json({ error: "复盘对应的持仓周期不正确" }, { status: 400 });
    }
    if (buyReason.length > 300 || sellReason.length > 300 || lesson.length > 500) {
      return Response.json({ error: "复盘内容过长" }, { status: 400 });
    }
    await ensureSchema();
    const db = getDb();
    const trades = await db.select().from(tradeRecords);
    const cycle = buildTradeCycles(trades).find((item) =>
      item.symbol === symbol && item.endTradeId === cycleEndTradeId
    );
    if (!cycle) {
      return Response.json({ error: "没有找到已经清仓的对应交易" }, { status: 400 });
    }
    const duplicate = await db.select().from(reviews);
    if (duplicate.some((review) => review.cycleEndTradeId === cycleEndTradeId)) {
      return Response.json({ error: "这次持仓周期已经完成复盘" }, { status: 409 });
    }
    const [review] = await db.insert(reviews).values({
      symbol,
      name: cycle.name,
      cycleEndTradeId,
      buyReason,
      sellReason,
      followedPlan,
      lesson,
      resultCents: cycle.realizedCents,
    }).returning();
    return Response.json({ review }, { status: 201 });
  } catch {
    return Response.json({ error: "复盘保存失败" }, { status: 500 });
  }
}
