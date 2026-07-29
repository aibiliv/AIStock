import { desc } from "drizzle-orm";
import { ensureSchema, getDb } from "../../../db";
import { reviews } from "../../../db/schema";
import { isStockCode, toCents } from "../../../lib/domain";

export async function GET() {
  try {
    await ensureSchema();
    return Response.json({ reviews: await getDb().select().from(reviews).orderBy(desc(reviews.id)) });
  } catch {
    return Response.json({ error: "复盘暂时无法读取" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as Record<string, unknown>;
    const symbol = String(payload.symbol ?? "").trim();
    const name = String(payload.name ?? "").trim();
    const buyReason = String(payload.buyReason ?? "").trim();
    const sellReason = String(payload.sellReason ?? "").trim();
    const lesson = String(payload.lesson ?? "").trim();
    const followedPlan = payload.followedPlan === true;
    const resultCents = toCents(payload.result);
    if (!isStockCode(symbol) || !name || !buyReason || !sellReason || !lesson) {
      return Response.json({ error: "请完整填写复盘内容" }, { status: 400 });
    }
    if (buyReason.length > 300 || sellReason.length > 300 || lesson.length > 500) {
      return Response.json({ error: "复盘内容过长" }, { status: 400 });
    }
    await ensureSchema();
    const [review] = await getDb().insert(reviews).values({
      symbol,
      name,
      buyReason,
      sellReason,
      followedPlan,
      lesson,
      resultCents,
    }).returning();
    return Response.json({ review }, { status: 201 });
  } catch {
    return Response.json({ error: "复盘保存失败" }, { status: 500 });
  }
}
