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
  const finiteOrNull = (item: unknown) => item === null || Number.isFinite(item);
  const strings = (item: unknown) =>
    Array.isArray(item) && item.every((entry) => typeof entry === "string");
  const position = context.position;
  return Boolean(
    typeof context.stock?.code === "string" &&
    typeof context.stock.name === "string" &&
    typeof context.stock.industry === "string" &&
    (context.stock.instrumentType === "stock" || context.stock.instrumentType === "etf") &&
    Number.isFinite(context.quote?.price) &&
    Number.isFinite(context.quote?.changePercent) &&
    Number.isFinite(context.quote?.ma20) &&
    Number.isFinite(context.quote?.support) &&
    Number.isFinite(context.quote?.resistance) &&
    Number.isFinite(context.quote?.volatility) &&
    (context.quote?.marketTime === null || typeof context.quote?.marketTime === "string") &&
    finiteOrNull(context.financials?.revenueGrowth) &&
    finiteOrNull(context.financials?.profitGrowth) &&
    finiteOrNull(context.financials?.debtRatio) &&
    finiteOrNull(context.financials?.pe) &&
    finiteOrNull(context.financials?.pb) &&
    finiteOrNull(context.financials?.roe) &&
    typeof context.summary === "string" &&
    strings(context.risks) &&
    strings(context.missingInformation) &&
    typeof context.source?.name === "string" &&
    typeof context.source.fetchedAt === "string" &&
    (
      position === null ||
      (
        Number.isFinite(position?.quantity) &&
        Number.isFinite(position?.averageCost) &&
        Number.isFinite(position?.returnPercent) &&
        finiteOrNull(position?.stockPositionPercent)
      )
    ) &&
    finiteOrNull(context.portfolio?.totalAssets) &&
    finiteOrNull(context.portfolio?.cash) &&
    finiteOrNull(context.portfolio?.totalPositionPercent) &&
    finiteOrNull(context.portfolio?.totalProfitPercent) &&
    JSON.stringify(value).length <= 40_000
  );
}

function summarizeContext(ctx: AssistantContext): string {
  const s = ctx.stock;
  const q = ctx.quote;
  const f = ctx.financials;
  const lines = [
    `股票：${s.name}(${s.code})，类型=${s.instrumentType}，行业=${s.industry ?? "未知"}`,
    `行情时间：${q.marketTime ?? "未提供"}`,
    `当前价=${q.price}，涨跌幅=${q.changePercent.toFixed(2)}%，MA20=${q.ma20}`,
    `风险观察线(支撑)=${q.support}，阻力=${q.resistance}，近20日平均波动=${q.volatility.toFixed(2)}%`,
    `财务：营收增长=${f.revenueGrowth ?? "数据缺失"}，利润增长=${f.profitGrowth ?? "数据缺失"}，负债率=${f.debtRatio ?? "数据缺失"}，PE=${f.pe ?? "数据缺失"}，PB=${f.pb ?? "数据缺失"}，ROE=${f.roe ?? "数据缺失"}`,
    `一句话结论：${ctx.summary}`,
    `已识别风险：${(ctx.risks ?? []).join("；") || "无"}`,
    `缺失信息：${(ctx.missingInformation ?? []).join("；") || "无"}`,
    `数据来源：${ctx.source.name}（获取于 ${ctx.source.fetchedAt}）`,
  ];
  if (ctx.position) {
    const p = ctx.position;
    lines.push(`我的持仓：${p.quantity}股，成本=${p.averageCost}，当前回报=${p.returnPercent.toFixed(2)}%，占账户仓位=${p.stockPositionPercent ?? "数据缺失"}%`);
  } else {
    lines.push("我的持仓：无");
  }
  const pf = ctx.portfolio;
  lines.push(`账户：总资产=${pf.totalAssets ?? "数据缺失"}，现金=${pf.cash ?? "数据缺失"}，总仓位=${pf.totalPositionPercent ?? "数据缺失"}%，账户总收益=${pf.totalProfitPercent ?? "数据缺失"}%`);
  return lines.join("\n");
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
              "你是股票复盘软件里的资深操盘手，有十年以上实盘经验。风格果断、直接，敢于给出明确的买卖动作和方向判断。对用户而言，你是为他盯盘、管仓的实战搭档，不是学院派讲师。",
              "【硬约束，违反即犯错】",
              "1. 一切观点和数字必须来自下方 context 与上文对话；context 未出现的数字（目标价、PE、仓位占比、ROE 等）一律不得编造，缺失就直说“数据缺失”。",
              "2. 任何买卖动作前必须先核对总仓位、现金、单股集中度；缺账户资金数据时不得下买卖结论，只能要求用户先补全账户资金。",
              "3. 必须结合用户持仓与该股在账户中的占比来给建议；无持仓时也要先点明“你当前无该股持仓记录”，再从旁观角度给方向。",
              "4. 用操盘手语言给动作：买/加仓/持有/减仓/清仓/设止损，并量化（如“现价可买约 X 成、约 N 股”“跌破支撑建议减仓，反弹不过阻力不追”）。不承诺收益、不替用户下单，最终由用户确认执行。",
              "5. 持仓建议是重点：根据当前价相对成本、支撑/阻力、该股占比与账户总仓位，明确给出加仓/持有/减仓/止损/止盈中哪一种，并说清触发条件。",
              "6. 回答固定四段：结论（直接亮明动作与倾向，干脆别铺垫）/ 依据（点出具体数字及其数据时间）/ 风险与缺口 / 下一步操作。",
              "7. 不超过500字，口语化、不啰嗦、少重复免责声明，把话说到点子上。",
              "8. 仓位建议必须展示计算：风险每股=max(当前价-支撑线,当前价×3%)；单笔可亏默认=总资产×2%（保守默认，可按风险偏好自调）；建议股数=单笔可亏÷风险每股，且≤可用现金、单股≤总资产30%；成数=建议金额÷总资产。数字只来自 context，缺失如实说明。",
              "【反幻觉示例】用户问“茅台 PE 多少、能买吗”而 pe=数据缺失 → 正确回答：“数据缺失：本次没取到 PE，我不凭记忆补数。能不能买看你的仓位和计划，先把账户资金补全、设好止损再谈。”",
              `context=\n${summarizeContext(payload.context as AssistantContext)}`,
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
