import { ensureSchema, getDb } from "../../../db";
import { analysisReports } from "../../../db/schema";
import { analyzeStockData, automaticExplanation } from "../../../lib/stocks";
import { getAiConfig } from "../../../lib/ai-config";

type DeepSeekResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

type Explanation = ReturnType<typeof automaticExplanation>;

function normalizeExplanation(value: unknown, fallback: Explanation): Explanation {
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as Record<string, unknown>;
  const strings = (input: unknown, limit: number) =>
    Array.isArray(input)
      ? input.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, limit)
      : [];
  const company = strings(candidate.company, 6);
  const risks = strings(candidate.risks, 8);
  const missingInformation = strings(candidate.missingInformation, 8);
  const themes = Array.isArray(candidate.themes)
    ? candidate.themes.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const theme = item as Record<string, unknown>;
        if (typeof theme.name !== "string" || typeof theme.reason !== "string") return [];
        return [{
          name: theme.name,
          confidence: typeof theme.confidence === "string" ? theme.confidence : "待核验",
          reason: theme.reason,
        }];
      }).slice(0, 8)
    : [];

  return {
    summary: typeof candidate.summary === "string" && candidate.summary.trim()
      ? candidate.summary.slice(0, 600)
      : fallback.summary,
    company: company.length ? company : fallback.company,
    risks: risks.length ? risks : fallback.risks,
    themes: themes.length ? themes : fallback.themes,
    missingInformation,
  };
}

async function getDeepSeekExplanation(facts: Awaited<ReturnType<typeof analyzeStockData>>) {
  const fallback = automaticExplanation(facts);
  const ai = getAiConfig();
  if (!ai.configured) {
    return { mode: "automatic" as const, explanation: fallback };
  }

  let response: Response;
  try {
    response = await fetch(`${ai.apiBase}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(20_000),
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${ai.apiKey}`,
      },
      body: JSON.stringify({
        model: ai.model,
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
  } catch {
    return { mode: "automatic" as const, explanation: fallback };
  }

  if (!response.ok) {
    return { mode: "automatic" as const, explanation: fallback };
  }
  const payload = await response.json() as DeepSeekResponse;
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    return { mode: "automatic" as const, explanation: fallback };
  }

  try {
    return { mode: "deepseek" as const, explanation: normalizeExplanation(JSON.parse(content), fallback) };
  } catch {
    return { mode: "automatic" as const, explanation: fallback };
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { query?: string; saveHistory?: boolean };
    const query = payload.query?.trim() ?? "";
    if (!query || query.length > 30) {
      return Response.json({ error: "请输入有效的股票代码或名称" }, { status: 400 });
    }

    const facts = await analyzeStockData(query);
    const analysis = await getDeepSeekExplanation(facts);
    const result = { ...facts, ...analysis };
    if (payload.saveHistory) {
      await ensureSchema();
      await getDb().insert(analysisReports).values({
        symbol: facts.stock.code,
        name: facts.stock.name,
        priceCents: Math.round(facts.quote.price * 100),
        marketTime: facts.quote.marketTime,
        source: facts.source.name,
        mode: analysis.mode,
        summary: analysis.explanation.summary,
        reportJson: JSON.stringify(result),
      });
    }
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "股票分析暂时不可用";
    return Response.json({ error: message }, { status: 502 });
  }
}
