import { desc } from "drizzle-orm";
import { ensureSchema, getDb } from "../../../db";
import { tradeRecords } from "../../../db/schema";
import { calculatePortfolio, isIsoDate, isStockCode, isTradeSide, toCents } from "../../../lib/domain";

export async function GET() {
  try {
    await ensureSchema();
    const rows = await getDb()
      .select()
      .from(tradeRecords)
      .orderBy(desc(tradeRecords.tradeDate), desc(tradeRecords.id))
      .limit(500);
    return Response.json({ trades: rows });
  } catch {
    return Response.json({ error: "交易记录暂时无法读取" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as Record<string, unknown>;
    const symbol = String(payload.symbol ?? "").trim();
    const name = String(payload.name ?? "").trim();
    const side = payload.side;
    const priceCents = toCents(payload.price);
    const quantity = Number(payload.quantity);
    const tradeDate = payload.tradeDate;
    const reason = String(payload.reason ?? "").trim();
    const maxLossCents = payload.maxLoss ? toCents(payload.maxLoss) : null;
    const feeCents = payload.fee ? toCents(payload.fee) : 0;

    if (!isStockCode(symbol) || !name || name.length > 30) {
      return Response.json({ error: "股票代码或名称不正确" }, { status: 400 });
    }
    if (!isTradeSide(side)) {
      return Response.json({ error: "买卖方向不正确" }, { status: 400 });
    }
    if (priceCents <= 0 || !Number.isInteger(quantity) || quantity <= 0) {
      return Response.json({ error: "价格和数量必须大于0" }, { status: 400 });
    }
    if (!isIsoDate(tradeDate)) {
      return Response.json({ error: "交易日期不正确" }, { status: 400 });
    }
    if (!reason || reason.length > 200) {
      return Response.json({ error: "请选择或填写交易原因" }, { status: 400 });
    }
    if ((maxLossCents !== null && maxLossCents <= 0) || feeCents < 0) {
      return Response.json({ error: "最大亏损和费用不能为负数" }, { status: 400 });
    }

    await ensureSchema();
    const db = getDb();
    if (side === "卖出") {
      const existingTrades = await db.select().from(tradeRecords);
      const position = calculatePortfolio(existingTrades).positions.find((item) => item.symbol === symbol);
      if (!position || quantity > position.quantity) {
        return Response.json({ error: `可卖数量不足，当前持仓${position?.quantity ?? 0}股` }, { status: 400 });
      }
    }
    const [trade] = await db.insert(tradeRecords).values({
      symbol,
      name,
      side,
      priceCents,
      quantity,
      tradeDate,
      reason,
      maxLossCents,
      feeCents,
    }).returning();
    return Response.json({ trade }, { status: 201 });
  } catch {
    return Response.json({ error: "交易记录保存失败，请稍后重试" }, { status: 500 });
  }
}
