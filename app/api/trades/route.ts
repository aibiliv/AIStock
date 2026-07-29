import { desc } from "drizzle-orm";
import { getDb } from "../../../db";
import { trades } from "../../../db/schema";

export async function GET() {
  try {
    const rows = await getDb().select().from(trades).orderBy(desc(trades.id)).limit(100);
    return Response.json({ trades: rows });
  } catch {
    return Response.json({ trades: [] });
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      symbol?: string;
      name?: string;
      side?: "买入" | "卖出";
      price?: number;
      quantity?: number;
      reason?: string;
      plan?: string;
    };

    if (!payload.symbol || !payload.name || !payload.side || !payload.price || !payload.quantity) {
      return Response.json({ error: "请填写完整的交易信息" }, { status: 400 });
    }

    const [trade] = await getDb().insert(trades).values({
      symbol: payload.symbol,
      name: payload.name,
      side: payload.side,
      price: payload.price,
      quantity: payload.quantity,
      reason: payload.reason ?? "",
      plan: payload.plan ?? "",
    }).returning();

    return Response.json({ trade }, { status: 201 });
  } catch {
    return Response.json({ error: "交易暂未同步，请稍后再试" }, { status: 500 });
  }
}
