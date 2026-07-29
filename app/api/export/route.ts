import { ensureSchema, getDb } from "../../../db";
import { alertRules, reviews, tradeRecords, watchItems } from "../../../db/schema";

export async function GET() {
  try {
    await ensureSchema();
    const db = getDb();
    const [trades, watchlist, alerts, reviewRows] = await Promise.all([
      db.select().from(tradeRecords),
      db.select().from(watchItems),
      db.select().from(alertRules),
      db.select().from(reviews),
    ]);
    const body = JSON.stringify({
      exportedAt: new Date().toISOString(),
      trades,
      watchlist,
      alerts,
      reviews: reviewRows,
    }, null, 2);
    return new Response(body, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="stock-assistant-backup-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  } catch {
    return Response.json({ error: "数据导出失败" }, { status: 500 });
  }
}
