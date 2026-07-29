import { eq, sql } from "drizzle-orm";
import { ensureSchema, getDb } from "../../../db";
import { accountSettings } from "../../../db/schema";
import { requireApiUser } from "../../../lib/auth";

export async function GET() {
  const unauthorized = await requireApiUser();
  if (unauthorized) return unauthorized;
  try {
    await ensureSchema();
    const [settings] = await getDb().select().from(accountSettings).where(eq(accountSettings.id, 1)).limit(1);
    return Response.json({ initialCapitalCents: settings?.initialCapitalCents ?? null });
  } catch {
    return Response.json({ error: "账户资金设置暂时无法读取" }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  const unauthorized = await requireApiUser();
  if (unauthorized) return unauthorized;
  const payload = await request.json().catch(() => null) as { initialCapital?: number } | null;
  const initialCapital = Number(payload?.initialCapital);
  if (!Number.isFinite(initialCapital) || initialCapital < 100 || initialCapital > 1_000_000_000) {
    return Response.json({ error: "账户初始资金应在100元到10亿元之间" }, { status: 400 });
  }

  try {
    await ensureSchema();
    const initialCapitalCents = Math.round(initialCapital * 100);
    await getDb().insert(accountSettings).values({
      id: 1,
      initialCapitalCents,
    }).onConflictDoUpdate({
      target: accountSettings.id,
      set: { initialCapitalCents, updatedAt: sql`CURRENT_TIMESTAMP` },
    });
    return Response.json({ initialCapitalCents });
  } catch {
    return Response.json({ error: "账户资金设置保存失败" }, { status: 500 });
  }
}
