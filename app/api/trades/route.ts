import { desc } from "drizzle-orm";
import { ensureSchema, getDb } from "../../../db";
import { alertRules, tradeRecords } from "../../../db/schema";
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
    const rawPrice = Number(payload.price);
    const maxLossNumber = Number(payload.maxLoss);
    const rawMaxLoss =
      payload.maxLoss === undefined || payload.maxLoss === null || payload.maxLoss === "" || maxLossNumber === 0
        ? null
        : maxLossNumber;
    const rawFee = payload.fee === undefined || payload.fee === null || payload.fee === ""
      ? 0
      : Number(payload.fee);
    const priceCents = toCents(rawPrice);
    const quantity = Number(payload.quantity);
    const tradeDate = payload.tradeDate;
    const reason = String(payload.reason ?? "").trim();
    const maxLossCents = rawMaxLoss === null ? null : toCents(rawMaxLoss);
    const feeCents = toCents(rawFee);

    if (!isStockCode(symbol) || !name || name.length > 30) {
      return Response.json({ error: "股票代码或名称不正确" }, { status: 400 });
    }
    if (!isTradeSide(side)) {
      return Response.json({ error: "买卖方向不正确" }, { status: 400 });
    }
    if (!Number.isFinite(rawPrice) || priceCents <= 0 || !Number.isInteger(quantity) || quantity <= 0) {
      return Response.json({ error: "价格和数量必须大于0" }, { status: 400 });
    }
    if (!isIsoDate(tradeDate)) {
      return Response.json({ error: "交易日期不正确" }, { status: 400 });
    }
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
    if (tradeDate > today) {
      return Response.json({ error: "交易日期不能晚于今天" }, { status: 400 });
    }
    if (!reason || reason.length > 200) {
      return Response.json({ error: "请选择或填写交易原因" }, { status: 400 });
    }
    if (
      (rawMaxLoss !== null && (!Number.isFinite(rawMaxLoss) || maxLossCents === null || maxLossCents <= 0)) ||
      !Number.isFinite(rawFee) ||
      feeCents < 0
    ) {
      return Response.json({ error: "最大亏损和费用不能为负数" }, { status: 400 });
    }
    const riskPerShareCents = maxLossCents === null ? null : Math.round(maxLossCents / quantity);
    if (side === "买入" && riskPerShareCents !== null && riskPerShareCents >= priceCents) {
      return Response.json({ error: "最大亏损必须小于本次买入金额" }, { status: 400 });
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
    const tradeValues = {
      symbol,
      name,
      side,
      priceCents,
      quantity,
      tradeDate,
      reason,
      maxLossCents,
      feeCents,
    };
    let trade;
    if (side === "买入" && riskPerShareCents !== null) {
      const [tradeRows] = await db.batch([
        db.insert(tradeRecords).values(tradeValues).returning(),
        db.insert(alertRules).values([
          { symbol, name, type: "止损", targetPriceCents: priceCents - riskPerShareCents },
          { symbol, name, type: "止盈一", targetPriceCents: priceCents + riskPerShareCents },
          { symbol, name, type: "止盈二", targetPriceCents: priceCents + riskPerShareCents * 2 },
        ]),
      ]);
      trade = tradeRows[0];
    } else {
      [trade] = await db.insert(tradeRecords).values(tradeValues).returning();
    }
    return Response.json({ trade }, { status: 201 });
  } catch {
    return Response.json({ error: "交易记录保存失败，请稍后重试" }, { status: 500 });
  }
}
