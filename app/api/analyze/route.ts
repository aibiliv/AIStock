import { env } from "cloudflare:workers";
import { analyzeStockData, automaticExplanation } from "../../../lib/stocks";

type DeepSeekResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

async function getDeepSeekExplanation(facts: Awaited<ReturnType<typeof analyzeStockData>>) {
  const runtimeEnv = env as unknown as { DEEPSEEK_API_KEY?: string };
  if (!runtimeEnv.DEEPSEEK_API_KEY) {
    return { mode: "automatic" as const, explanation: automaticExplanation(facts) };
  }

  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${runtimeEnv.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      response_format: { type: "json_object" },
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: [
            "你是个人股票复盘工具中的信息解释助手。",
            "只能使用用户提供的事实，不补充或编造数字。",
            "不荐股，不使用必涨、买入、卖出等确定性指令。",
            "输出JSON，字段必须包含summary、company、risks、themes、missingInformation。",
            "company和risks为字符串数组；themes为{name,confidence,reason}数组。",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify(facts),
        },
      ],
    }),
  });

  if (!response.ok) {
    return { mode: "automatic" as const, explanation: automaticExplanation(facts) };
  }
  const payload = await response.json() as DeepSeekResponse;
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    return { mode: "automatic" as const, explanation: automaticExplanation(facts) };
  }

  try {
    return { mode: "deepseek" as const, explanation: JSON.parse(content) };
  } catch {
    return { mode: "automatic" as const, explanation: automaticExplanation(facts) };
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { query?: string };
    const query = payload.query?.trim() ?? "";
    if (!query || query.length > 30) {
      return Response.json({ error: "请输入有效的股票代码或名称" }, { status: 400 });
    }

    const facts = await analyzeStockData(query);
    const analysis = await getDeepSeekExplanation(facts);
    return Response.json({ ...facts, ...analysis });
  } catch (error) {
    const message = error instanceof Error ? error.message : "股票分析暂时不可用";
    return Response.json({ error: message }, { status: 502 });
  }
}
