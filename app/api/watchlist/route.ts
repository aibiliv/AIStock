import { eq } from "drizzle-orm";
import { ensureSchema, getDb } from "../../../db";
import { watchItems } from "../../../db/schema";
import { isStockCode } from "../../../lib/domain";

export async function GET() {
  try {
    await ensureSchema();
    return Response.json({ items: await getDb().select().from(watchItems).orderBy(watchItems.id) });
  } catch {
    return Response.json({ error: "关注列表暂时无法读取" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { symbol?: string; name?: string; note?: string };
    const symbol = payload.symbol?.trim() ?? "";
    const name = payload.name?.trim() ?? "";
    const note = payload.note?.trim() ?? "";
    if (!isStockCode(symbol) || !name || name.length > 30 || note.length > 200) {
      return Response.json({ error: "关注信息不正确" }, { status: 400 });
    }

    await ensureSchema();
    const db = getDb();
    const existing = await db.select().from(watchItems).where(eq(watchItems.symbol, symbol)).limit(1);
    if (existing.length) {
      return Response.json({ item: existing[0], existed: true });
    }
    const [item] = await db.insert(watchItems).values({ symbol, name, note }).returning();
    return Response.json({ item }, { status: 201 });
  } catch {
    return Response.json({ error: "加入关注失败" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const symbol = new URL(request.url).searchParams.get("symbol")?.trim() ?? "";
    if (!isStockCode(symbol)) {
      return Response.json({ error: "股票代码不正确" }, { status: 400 });
    }
    await ensureSchema();
    await getDb().delete(watchItems).where(eq(watchItems.symbol, symbol));
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "取消关注失败" }, { status: 500 });
  }
}
