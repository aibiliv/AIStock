import { getAiConfig } from "../../../lib/ai-config";
import { requireApiUser } from "../../../lib/auth";

export async function GET() {
  const unauthorized = await requireApiUser();
  if (unauthorized) return unauthorized;
  const ai = getAiConfig();
  return Response.json({
    deepseekConfigured: ai.configured,
    aiProvider: ai.provider,
    dataSource: "腾讯证券 / Yahoo公开行情",
    reminderMode: "页面打开期间每5分钟检查",
  });
}
