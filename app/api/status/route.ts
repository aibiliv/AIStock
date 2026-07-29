import { env } from "cloudflare:workers";

export async function GET() {
  const runtimeEnv = env as unknown as { DEEPSEEK_API_KEY?: string };
  return Response.json({
    deepseekConfigured: Boolean(runtimeEnv.DEEPSEEK_API_KEY),
    dataSource: "腾讯证券 / Yahoo公开行情",
    reminderMode: "页面打开期间每5分钟检查",
  });
}
