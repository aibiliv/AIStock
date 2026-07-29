import { getAiConfig } from "../../../lib/ai-config";
import { buildFallbackAnswer, type AssistantContext } from "../../../lib/assistant";
import { requireApiUser } from "../../../lib/auth";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type ChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

function validContext(value: unknown): value is AssistantContext {
  if (!value || typeof value !== "object") return false;
  const context = value as Partial<AssistantContext>;
  return Boolean(
    context.stock?.code &&
    context.stock.name &&
    Number.isFinite(context.quote?.price) &&
    context.source?.name &&
    context.portfolio &&
    Object.hasOwn(context.portfolio, "totalPositionPercent")
  );
}

export async function POST(request: Request) {
  const unauthorized = await requireApiUser();
  if (unauthorized) return unauthorized;

  const payload = await request.json().catch(() => null) as {
    question?: string;
    context?: unknown;
    messages?: unknown;
  } | null;
  const question = payload?.question?.trim() ?? "";
  if (!question || question.length > 300 || !validContext(payload?.context)) {
    return Response.json({ error: "问题或分析上下文不正确" }, { status: 400 });
  }

  const messages = Array.isArray(payload?.messages)
    ? payload.messages.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const message = item as Partial<ChatMessage>;
        if (
          (message.role !== "user" && message.role !== "assistant") ||
          typeof message.content !== "string" ||
          !message.content.trim()
        ) {
          return [];
        }
        return [{ role: message.role, content: message.content.slice(0, 1200) }];
      }).slice(-8)
    : [];

  const fallback = buildFallbackAnswer(question, payload.context);
  const ai = getAiConfig();
  if (!ai.configured) {
    return Response.json({ answer: fallback, mode: "automatic" });
  }

  try {
    const response = await fetch(`${ai.apiBase}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(25_000),
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${ai.apiKey}`,
      },
      body: JSON.stringify({
        model: ai.model,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: [
              "你是股票复盘软件中的证据型对话助手。",
              "只能使用context给出的事实和对话，不补充未经提供的数据。",
              "遇到买入问题时，必须先检查总仓位、现金和单股集中度；缺少账户资金时不得判断。",
              "必须结合用户持仓信息；没有持仓时明确说明。",
              "不替用户作买卖决定，不给出保证收益或确定性的买入卖出指令；只能判断仓位约束和条件是否完备。",
              "回答使用四段：结论、依据、风险与缺口、下一步核验。",
              "依据必须标出具体数字及其数据时间；缺失信息要直接承认。",
              "回答简洁、通俗，控制在500字以内。",
              `context=${JSON.stringify(payload.context)}`,
            ].join("\n"),
          },
          ...messages,
          { role: "user", content: question },
        ],
      }),
    });
    if (!response.ok) {
      return Response.json({ answer: fallback, mode: "automatic" });
    }

    const result = await response.json().catch(() => null) as ChatResponse | null;
    const answer = result?.choices?.[0]?.message?.content?.trim();
    return Response.json({
      answer: answer ? answer.slice(0, 3000) : fallback,
      mode: answer ? ai.provider : "automatic",
    });
  } catch {
    return Response.json({ answer: fallback, mode: "automatic" });
  }
}
