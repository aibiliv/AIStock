export type AssistantContext = {
  stock: {
    code: string;
    name: string;
    industry: string;
    instrumentType: "stock" | "etf";
  };
  quote: {
    price: number;
    changePercent: number;
    ma20: number;
    support: number;
    resistance: number;
    volatility: number;
    marketTime: string | null;
  };
  financials: {
    revenueGrowth: number | null;
    profitGrowth: number | null;
    debtRatio: number | null;
    pe: number | null;
    pb: number | null;
    roe: number | null;
  };
  summary: string;
  risks: string[];
  missingInformation: string[];
  source: {
    name: string;
    fetchedAt: string;
  };
  position: {
    quantity: number;
    averageCost: number;
    returnPercent: number;
    stockPositionPercent: number | null;
  } | null;
  portfolio: {
    totalAssets: number | null;
    cash: number | null;
    totalPositionPercent: number | null;
    totalProfitPercent: number | null;
  };
};

function percent(value: number | null) {
  return value === null ? "暂无" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function buildFallbackAnswer(question: string, context: AssistantContext) {
  const { stock, quote, financials, position } = context;
  const evidenceTime = quote.marketTime ?? context.source.fetchedAt;

  if (/买入|加仓|仓位|还能买|是否买/.test(question)) {
    if (context.portfolio.totalPositionPercent === null) {
      return `结论：暂时不能判断仓位是否允许新增${stock.name}。\n依据：尚未设置账户初始资金，因此无法计算现金和总仓位。\n风险与缺口：缺少账户资金基准；价格与基本面条件也不能替代仓位约束。\n下一步：先在设置中填写账户初始资金，再进行买入条件检查。`;
    }
    const totalPosition = context.portfolio.totalPositionPercent;
    const stockPosition = position?.stockPositionPercent ?? 0;
    const constraint = totalPosition >= 80
      ? "总仓位已经较高，仓位约束不支持继续增加风险暴露"
      : stockPosition >= 20
        ? "该股票占比已经较高，应先处理集中度风险"
        : "仓位层面仍有空间，但这不代表标的已经满足买入条件";
    return `结论：${constraint}。\n依据：当前总仓位${totalPosition.toFixed(2)}%，${stock.name}仓位${stockPosition.toFixed(2)}%，现金${context.portfolio.cash === null ? "暂无" : `¥${context.portfolio.cash.toFixed(2)}`}；当前价¥${quote.price.toFixed(3)}，风险观察线¥${quote.support.toFixed(3)}。\n风险与缺口：仓位只能限制风险，不能证明未来会上涨；${context.missingInformation.slice(0, 2).join("、") || "最新公告仍需核验"}。\n下一步：先确认买入逻辑、失效条件和单笔最大亏损，再由你决定是否执行。`;
  }

  if (/持仓|成本|盈亏|回本/.test(question)) {
    if (!position) {
      return `结论：你还没有记录${stock.name}的持仓，暂时不能做个性化盈亏分析。\n依据：当前参考价为¥${quote.price.toFixed(2)}，行情时间为${evidenceTime}。\n风险与缺口：缺少持仓数量和成本。\n下一步：先记录买入，再询问“距离成本还有多少”。`;
    }
    return `结论：当前参考价相对你的持仓成本为${percent(position.returnPercent)}。\n依据：持仓${position.quantity}股，平均成本¥${position.averageCost.toFixed(3)}，当前参考价¥${quote.price.toFixed(3)}。\n风险与缺口：这是未实现盈亏估算，未计未来费用和滑点。\n下一步：结合¥${quote.support.toFixed(3)}风险观察线检查原买入逻辑是否仍成立。`;
  }

  if (/风险|下跌|止损|危险/.test(question)) {
    const risks = context.risks.slice(0, 3).map((item, index) => `${index + 1}. ${item}`).join("\n");
    return `结论：当前首先要核验价格风险和数据缺口。\n依据：20日风险观察线¥${quote.support.toFixed(3)}，近期平均日波动${quote.volatility.toFixed(2)}%。\n${risks}\n风险与缺口：${context.missingInformation.slice(0, 3).join("、") || "页面所列公开数据之外的信息尚未核验"}。\n下一步：跌破风险观察线后重新检查原判断，不把单一价格指标当成买卖指令。`;
  }

  if (/财务|业绩|估值|市盈率|市净率|ROE/i.test(question)) {
    return `结论：现有财务数据只能用于初筛，不能单独证明公司被低估或高估。\n依据：营收变化${percent(financials.revenueGrowth)}，利润变化${percent(financials.profitGrowth)}，市盈率${financials.pe?.toFixed(2) ?? "暂无"}，市净率${financials.pb?.toFixed(2) ?? "暂无"}，ROE${percent(financials.roe)}。\n风险与缺口：财务口径、报告期和一次性损益仍需结合公告核验。\n下一步：优先查看最近一期定期报告及业绩说明。`;
  }

  return `结论：${context.summary}\n依据：当前参考价¥${quote.price.toFixed(3)}，涨跌${percent(quote.changePercent)}，相对20日均线¥${quote.ma20.toFixed(3)}处于${quote.price >= quote.ma20 ? "上方" : "下方"}。\n风险与缺口：${context.missingInformation.slice(0, 3).join("、") || "仍需结合最新公告核验"}。\n下一步：你可以继续问“主要风险是什么”“结合我的成本怎么看”或“财务数据说明了什么”。`;
}
