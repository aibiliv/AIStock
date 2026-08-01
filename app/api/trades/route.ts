import { desc } from "drizzle-orm";
import { ensureSchema, getDb } from "../../../db";
import { alertRules, tradeRecords } from "../../../db/schema";
import { findInvalidSell, isIsoDate, isStockCode, isTradeSide, toCents, toTenThousandths } from "../../../lib/domain";
import { canonicalStockName } from "../../../lib/stocks";
import { requireApiUser } from "../../../lib/auth";

export async function GET() {
  const unauthorized = await requireApiUser();
  if (unauthorized) return unauthorized;
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
  const unauthorized = await requireApiUser();
  if (unauthorized) return unauthorized;
  try {
    const payload = await request.json() as Record<string, unknown>;
    const symbol = String(payload.symbol ?? "").trim();
    const name = canonicalStockName(symbol, String(payload.name ?? "").trim());
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
    const priceTenThousandths = toTenThousandths(rawPrice);
    const priceMillis = Math.round(priceTenThousandths / 10);
    const priceCents = Math.round(priceTenThousandths / 100);
    const quantity = Number(payload.quantity);
    const tradeDate = payload.tradeDate;
    const reason = String(payload.reason ?? "").trim();
    const otherReason = String(payload.otherReason ?? "").trim();
    const maxLossCents = rawMaxLoss === null ? null : toCents(rawMaxLoss);
    const feeCents = toCents(rawFee);

    if (!isStockCode(symbol) || !name || name.length > 30) {
      return Response.json({ error: "股票代码或名称不正确" }, { status: 400 });
    }
    if (!isTradeSide(side)) {
      return Response.json({ error: "买卖方向不正确" }, { status: 400 });
    }
    if (
      !Number.isFinite(rawPrice) ||
      priceTenThousandths <= 0 ||
      !Number.isSafeInteger(priceTenThousandths) ||
      !Number.isSafeInteger(quantity) ||
      quantity <= 0 ||
      !Number.isSafeInteger(priceTenThousandths * quantity)
    ) {
      return Response.json({ error: "价格和数量必须是有效的正数，且交易金额不能超出安全范围" }, { status: 400 });
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
      feeCents < 0 ||
      !Number.isSafeInteger(maxLossCents ?? 0) ||
      !Number.isSafeInteger(feeCents)
    ) {
      return Response.json({ error: "最大亏损和费用必须是安全范围内的非负数" }, { status: 400 });
    }
    const riskPerShareTenThousandths =
      maxLossCents === null ? null : Math.round(maxLossCents * 100 / quantity);
    if (
      side === "买入" &&
      riskPerShareTenThousandths !== null &&
      riskPerShareTenThousandths >= priceTenThousandths
    ) {
      return Response.json({ error: "最大亏损必须小于本次买入金额" }, { status: 400 });
    }

    await ensureSchema();
    const db = getDb();
    const existingTrades = await db.select().from(tradeRecords);
    const nextId = existingTrades.reduce((largest, trade) => Math.max(largest, trade.id), 0) + 1;
    const invalidSell = side === "卖出"
      ? findInvalidSell([...existingTrades, {
          id: nextId,
          symbol,
          name,
          side,
          priceCents,
          priceMillis,
          priceTenThousandths,
          quantity,
          tradeDate,
          reason,
          maxLossCents,
          feeCents,
        }])
      : null;
    if (invalidSell) {
      return Response.json({
        error: `按交易日期排序后可卖数量不足：${invalidSell.symbol}可卖${invalidSell.availableQuantity}股，本次卖出${invalidSell.requestedQuantity}股`,
      }, { status: 400 });
    }
    const tradeValues = {
      symbol,
      name,
      side,
      priceCents,
      priceMillis,
      priceTenThousandths,
      quantity,
      tradeDate,
      reason,
      maxLossCents,
      feeCents,
      otherReason: otherReason || null,
    };
    let trade;
    if (side === "买入" && riskPerShareTenThousandths !== null) {
      const targets = [
        { type: "止损" as const, price: priceTenThousandths - riskPerShareTenThousandths },
        { type: "止盈一" as const, price: priceTenThousandths + riskPerShareTenThousandths },
        { type: "止盈二" as const, price: priceTenThousandths + riskPerShareTenThousandths * 2 },
      ];
      const [tradeRows] = await db.batch([
        db.insert(tradeRecords).values(tradeValues).returning(),
        db.insert(alertRules).values(targets.map((target) => ({
          symbol,
          name,
          type: target.type,
          targetPriceCents: Math.round(target.price / 100),
          targetPriceMillis: Math.round(target.price / 10),
        }))),
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
