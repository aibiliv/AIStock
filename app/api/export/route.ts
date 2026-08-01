import { ensureSchema, getDb } from "../../../db";
import {
  alertRules,
  accountSettings,
  analysisReports,
  announcementNotes,
  reviews,
  tradeRecords,
  watchDetails,
  watchItems,
} from "../../../db/schema";
import { requireApiUser } from "../../../lib/auth";
import { shanghaiDate, shanghaiIso } from "../../../lib/time";

export async function GET() {
  const unauthorized = await requireApiUser();
  if (unauthorized) return unauthorized;
  try {
    await ensureSchema();
    const db = getDb();
    const [trades, watchlist, watchDetailRows, alerts, reviewRows, analysisHistory, announcements, account] = await Promise.all([
      db.select().from(tradeRecords),
      db.select().from(watchItems),
      db.select().from(watchDetails),
      db.select().from(alertRules),
      db.select().from(reviews),
      db.select().from(analysisReports),
      db.select().from(announcementNotes),
      db.select().from(accountSettings),
    ]);
    const body = JSON.stringify({
      exportedAt: shanghaiIso(),
      trades,
      watchlist,
      watchDetails: watchDetailRows,
      alerts,
      reviews: reviewRows,
      analysisHistory,
      announcements,
      accountSettings: account,
    }, null, 2);
    return new Response(body, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="stock-assistant-backup-${shanghaiDate()}.json"`,
      },
    });
  } catch {
    return Response.json({ error: "数据导出失败" }, { status: 500 });
  }
}
