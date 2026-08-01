import { eq } from "drizzle-orm";
import { ensureSchema, getDb } from "../../../db";
import { watchDetails, watchItems } from "../../../db/schema";
import { isStockCode } from "../../../lib/domain";
import { canonicalStockName } from "../../../lib/stocks";
import { requireApiUser } from "../../../lib/auth";
import { shanghaiIso } from "../../../lib/time";

export async function GET() {
  const unauthorized = await requireApiUser();
  if (unauthorized) return unauthorized;
  try {
    await ensureSchema();
    const db = getDb();
    const [items, details] = await Promise.all([
      db.select().from(watchItems).orderBy(watchItems.id),
      db.select().from(watchDetails),
    ]);
    const detailsBySymbol = new Map(details.map((detail) => [detail.symbol, detail]));
    return Response.json({
      items: items.map((item) => ({
        ...item,
        conditionText: detailsBySymbol.get(item.symbol)?.conditionText ?? item.note ?? "等待自己的买入条件",
        status: detailsBySymbol.get(item.symbol)?.status ?? "研究中",
        lastReviewedAt: detailsBySymbol.get(item.symbol)?.lastReviewedAt ?? null,
        updatedAt: detailsBySymbol.get(item.symbol)?.updatedAt ?? item.createdAt,
        conditionMetric: detailsBySymbol.get(item.symbol)?.conditionMetric ?? null,
        conditionDirection: detailsBySymbol.get(item.symbol)?.conditionDirection ?? null,
        conditionValue: detailsBySymbol.get(item.symbol)?.conditionValue ?? null,
      })),
    });
  } catch {
    return Response.json({ error: "关注列表暂时无法读取" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const unauthorized = await requireApiUser();
  if (unauthorized) return unauthorized;
  try {
    const payload = await request.json() as { symbol?: string; name?: string; note?: string; conditionText?: string };
    const symbol = payload.symbol?.trim() ?? "";
    const name = canonicalStockName(symbol, payload.name?.trim() ?? "");
    const note = payload.note?.trim() ?? "";
    const conditionText = payload.conditionText?.trim() || note || "等待自己的买入条件";
    if (!isStockCode(symbol) || !name || name.length > 30 || note.length > 200 || conditionText.length > 300) {
      return Response.json({ error: "关注信息不正确" }, { status: 400 });
    }

    await ensureSchema();
    const db = getDb();
    const existing = await db.select().from(watchItems).where(eq(watchItems.symbol, symbol)).limit(1);
    if (existing.length) {
      const detail = await db.select().from(watchDetails).where(eq(watchDetails.symbol, symbol)).limit(1);
      return Response.json({
        item: {
          ...existing[0],
          conditionText: detail[0]?.conditionText ?? existing[0].note ?? "等待自己的买入条件",
          status: detail[0]?.status ?? "研究中",
          lastReviewedAt: detail[0]?.lastReviewedAt ?? null,
          updatedAt: detail[0]?.updatedAt ?? existing[0].createdAt,
        },
        existed: true,
      });
    }
    const [itemRows] = await db.batch([
      db.insert(watchItems).values({ symbol, name, note, createdAt: shanghaiIso() }).returning(),
      db.insert(watchDetails).values({ symbol, conditionText, status: "研究中", tradedAt: shanghaiIso() }),
    ]);
    const item = itemRows[0];
    return Response.json({ item: { ...item, conditionText, status: "研究中", lastReviewedAt: null } }, { status: 201 });
  } catch {
    return Response.json({ error: "加入关注失败" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const unauthorized = await requireApiUser();
  if (unauthorized) return unauthorized;
  try {
    const payload = await request.json() as {
      symbol?: string;
      conditionText?: string;
      status?: string;
      conditionMetric?: string;
      conditionDirection?: string;
      conditionValue?: number;
    };
    const symbol = payload.symbol?.trim() ?? "";
    const conditionText = payload.conditionText?.trim() ?? "";
    const statuses = new Set(["研究中", "等待条件", "已买入", "暂停"]);
    if (!isStockCode(symbol) || !conditionText || conditionText.length > 300 || !statuses.has(payload.status ?? "")) {
      return Response.json({ error: "观察条件或状态不正确" }, { status: 400 });
    }

    const metric = (payload.conditionMetric ?? "").trim();
    const direction = (payload.conditionDirection ?? "").trim();
    const rawValue = Number(payload.conditionValue);
    const metricSet = new Set(["price", "change"]);
    const directionSet = new Set(["above", "below"]);
    let conditionMetric: string | null = null;
    let conditionDirection: string | null = null;
    let conditionValue: number | null = null;
    if (metric) {
      if (!metricSet.has(metric) || !directionSet.has(direction) || !Number.isFinite(rawValue)) {
        return Response.json({ error: "触发条件不正确" }, { status: 400 });
      }
      conditionMetric = metric;
      conditionDirection = direction;
      conditionValue = rawValue;
    }

    await ensureSchema();
    const db = getDb();
    const item = await db.select({ symbol: watchItems.symbol })
      .from(watchItems)
      .where(eq(watchItems.symbol, symbol))
      .limit(1);
    if (!item.length) {
      return Response.json({ error: "关注股票不存在" }, { status: 404 });
    }
    const existing = await db.select().from(watchDetails).where(eq(watchDetails.symbol, symbol)).limit(1);
    const values = {
      conditionText,
      status: payload.status as "研究中" | "等待条件" | "已买入" | "暂停",
      lastReviewedAt: shanghaiIso(),
      updatedAt: shanghaiIso(),
      conditionMetric,
      conditionDirection,
      conditionValue,
    };
    const [detail] = existing.length
      ? await db.update(watchDetails).set(values).where(eq(watchDetails.symbol, symbol)).returning()
      : await db.insert(watchDetails).values({ symbol, ...values, tradedAt: shanghaiIso() }).returning();
    return Response.json({ detail });
  } catch {
    return Response.json({ error: "观察条件保存失败" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const unauthorized = await requireApiUser();
  if (unauthorized) return unauthorized;
  try {
    const symbol = new URL(request.url).searchParams.get("symbol")?.trim() ?? "";
    if (!isStockCode(symbol)) {
      return Response.json({ error: "股票代码不正确" }, { status: 400 });
    }
    await ensureSchema();
    const db = getDb();
    const [, deletedItems] = await db.batch([
      db.delete(watchDetails).where(eq(watchDetails.symbol, symbol)),
      db.delete(watchItems).where(eq(watchItems.symbol, symbol)).returning({ symbol: watchItems.symbol }),
    ]);
    return deletedItems.length
      ? Response.json({ ok: true })
      : Response.json({ error: "关注股票不存在" }, { status: 404 });
  } catch {
    return Response.json({ error: "取消关注失败" }, { status: 500 });
  }
}
