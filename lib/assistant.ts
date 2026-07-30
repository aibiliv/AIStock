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
    if (context.portfolio.totalPositionPercent === null || context.portfolio.totalAssets === null) {
      return `结论：暂时不能判断仓位是否允许新增${stock.name}。\n依据：尚未设置账户初始资金，因此无法计算现金和总仓位。\n风险与缺口：缺少账户资金基准；价格与基本面条件也不能替代仓位约束。\n下一步：先在设置中填写账户初始资金，再进行买入条件检查。`;
    }
    const totalPosition = context.portfolio.totalPositionPercent;
    const stockPosition = position?.stockPositionPercent ?? 0;
    const totalAssets = context.portfolio.totalAssets;
    const riskPerShare = Math.max(quote.price - quote.support, quote.price * 0.03);
    const maxLoss = totalAssets * 0.02;
    let shares = riskPerShare > 0 ? Math.floor(maxLoss / riskPerShare) : 0;
    const maxByCash = context.portfolio.cash == null ? Infinity : Math.floor(context.portfolio.cash / quote.price);
    const maxByConcentration = Math.floor((totalAssets * 0.3) / quote.price);
    shares = Math.max(0, Math.min(shares, maxByCash, maxByConcentration));
    const cheng = totalAssets > 0 ? (shares * quote.price) / totalAssets : 0;
    const constraint = totalPosition >= 80
      ? "总仓位已高，先别加风险暴露，优先处理已有仓位"
      : stockPosition >= 20
        ? "该股占比已高，先降集中度，别再堆单票"
        : "仓位还有空间，但空间不等于买点，标的得自己过关";
    return `结论：操盘手视角——${constraint}。\n依据：当前总仓位${totalPosition.toFixed(2)}%，${stock.name}仓位${stockPosition.toFixed(2)}%，现金${context.portfolio.cash === null ? "暂无" : `¥${context.portfolio.cash.toFixed(2)}`}；当前价¥${quote.price.toFixed(3)}，风险观察线¥${quote.support.toFixed(3)}，单笔风险每股¥${riskPerShare.toFixed(3)}。\n可挂单仓位：约${cheng.toFixed(2)}成（约${shares}股），按价格到支撑线的距离控单笔亏损（默认单笔可亏=总资产2%、单股不超30%），最终由你确认执行。\n风险与缺口：仓位只限风险，不证明会涨；${context.missingInformation.slice(0, 2).join("、") || "最新公告仍需核验"}。\n下一步：先定买入逻辑、失效条件和单笔最大亏损，再决定下不下手。`;
  }

  if (/卖出|减仓|清仓|止盈|获利了结|离场/.test(question)) {
    if (!position) {
      return `结论：你当前无${stock.name}持仓记录，谈不上减仓或清仓。\n依据：当前参考价¥${quote.price.toFixed(3)}，行情时间${evidenceTime}，位于支撑¥${quote.support.toFixed(3)}与阻力¥${quote.resistance.toFixed(3)}之间。\n风险与缺口：没有持仓就给不出持仓层面的卖出动作。\n下一步：若只是旁观，技术面跌破¥${quote.support.toFixed(3)}转弱、反弹不过¥${quote.resistance.toFixed(3)}不追。`;
    }
    const p = position;
    const belowSupport = quote.price < quote.support;
    const nearResistance = quote.price >= quote.resistance * 0.98;
    const concentration = p.stockPositionPercent ?? 0;
    let action: string;
    let reason: string;
    if (belowSupport) {
      action = "建议减仓/止损";
      reason = `价格已跌破风险观察线¥${quote.support.toFixed(3)}，原买入逻辑失效，先砍风险`;
    } else if (p.returnPercent <= 0 && concentration >= 20) {
      action = "建议减仓降集中";
      reason = `浮亏且该股占仓${concentration.toFixed(2)}%偏高，先降单票风险`;
    } else if (p.returnPercent > 0 && nearResistance) {
      action = "建议分批止盈/减仓";
      reason = `已有盈利且逼近阻力¥${quote.resistance.toFixed(3)}，落袋为安不贪`;
    } else if (concentration >= 30) {
      action = "建议减仓降集中";
      reason = `该股占仓${concentration.toFixed(2)}%过高，超30%警戒需压回`;
    } else {
      action = "建议持有并设好止损";
      reason = `仍在支撑上方、占仓${concentration.toFixed(2)}%未超标，持有观察，跌破¥${quote.support.toFixed(3)}再动`;
    }
    return `结论：${action}。\n依据：持仓${p.quantity}股，成本¥${p.averageCost.toFixed(3)}，当前¥${quote.price.toFixed(3)}，相对成本${percent(p.returnPercent)}；支撑¥${quote.support.toFixed(3)}、阻力¥${quote.resistance.toFixed(3)}，占仓${concentration.toFixed(2)}%。\n风险与缺口：${reason}；${context.missingInformation.slice(0, 2).join("、") || "最新公告仍需核验"}。\n下一步：执行后把止损设在¥${quote.support.toFixed(3)}下方，单笔亏损控制在计划内，最终由你确认。`;
  }

  if (/持仓|成本|盈亏|回本|怎么办|怎么操作|怎么处理/.test(question)) {
    if (!position) {
      return `结论：你还没有记录${stock.name}的持仓，暂不能做个性化盈亏与持仓建议。\n依据：当前参考价¥${quote.price.toFixed(2)}，行情时间${evidenceTime}，位于支撑¥${quote.support.toFixed(3)}与阻力¥${quote.resistance.toFixed(3)}之间。\n风险与缺口：缺少持仓数量和成本。\n下一步：先记录买入，再问“我的持仓现在该怎么操作”。`;
    }
    const p = position;
    const belowSupport = quote.price < quote.support;
    const nearResistance = quote.price >= quote.resistance * 0.98;
    const concentration = p.stockPositionPercent ?? 0;
    let action: string;
    if (belowSupport) action = "止损/减仓——跌破支撑，逻辑失效先控风险";
    else if (p.returnPercent > 0 && nearResistance) action = "分批止盈/减仓——到阻力附近，落袋为安";
    else if (concentration >= 30) action = "减仓降集中——单票占仓超30%，压回风险";
    else action = `持有并盯止损——仍在支撑上方，止损设¥${quote.support.toFixed(3)}下方`;
    return `结论：当前持仓相对成本${percent(p.returnPercent)}，${action}。\n依据：持仓${p.quantity}股，成本¥${p.averageCost.toFixed(3)}，当前¥${quote.price.toFixed(3)}，占仓${concentration.toFixed(2)}%；支撑¥${quote.support.toFixed(3)}、阻力¥${quote.resistance.toFixed(3)}。\n风险与缺口：未实现盈亏，未计费用和滑点；${context.missingInformation.slice(0, 2).join("、") || "最新公告仍需核验"}。\n下一步：按动作执行，止损设在¥${quote.support.toFixed(3)}下方，最终由你确认。`;
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
