const STOCK_NAMES: Record<string, string> = {
  "000001": "平安银行",
  "000333": "美的集团",
  "000651": "格力电器",
  "000858": "五粮液",
  "002230": "科大讯飞",
  "002371": "北方华创",
  "002415": "海康威视",
  "002594": "比亚迪",
  "300059": "东方财富",
  "300308": "中际旭创",
  "300476": "胜宏科技",
  "300750": "宁德时代",
  "513180": "华夏恒生科技ETF（QDII）",
  "600036": "招商银行",
  "600276": "恒瑞医药",
  "600519": "贵州茅台",
  "601318": "中国平安",
  "601899": "紫金矿业",
  "601988": "中国银行",
  "601138": "工业富联",
  "688041": "海光信息",
  "688111": "金山办公",
  "688256": "寒武纪",
  "688981": "中芯国际",
};

const INDUSTRIES: Record<string, string> = {
  "000001": "银行",
  "000333": "家用电器",
  "000651": "家用电器",
  "000858": "白酒",
  "002230": "人工智能软件",
  "002371": "半导体设备",
  "002415": "计算机设备",
  "002594": "新能源汽车",
  "300059": "互联网金融",
  "300308": "光通信",
  "300476": "PCB · AI算力",
  "300750": "动力电池",
  "513180": "恒生科技指数",
  "600036": "银行",
  "600276": "创新药",
  "600519": "白酒",
  "601318": "保险",
  "601899": "黄金 · 有色",
  "601988": "银行",
  "601138": "AI服务器",
  "688041": "国产算力芯片",
  "688111": "办公软件",
  "688256": "AI芯片",
  "688981": "半导体制造",
};

const ETF_PROFILES: Record<string, {
  manager: string;
  trackingIndex: string;
  exchange: string;
  category: string;
  inceptionDate: string;
  sourceName: string;
  sourceUrl: string;
}> = {
  "513180": {
    manager: "华夏基金管理有限公司",
    trackingIndex: "恒生科技指数",
    exchange: "上海证券交易所",
    category: "跨境股票指数ETF（QDII）",
    inceptionDate: "2021-05-18",
    sourceName: "华夏基金",
    sourceUrl: "https://www.chinaamc.com.cn/fund/513180/index.shtml",
  },
};

export function isEtfCode(code: string) {
  return Boolean(ETF_PROFILES[code]);
}

type YahooChart = {
  chart?: {
    result?: Array<{
      meta?: {
        symbol?: string;
        shortName?: string;
        longName?: string;
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        regularMarketTime?: number;
        currency?: string;
      };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          close?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
    }>;
    error?: { description?: string };
  };
};

type FundamentalSeries = {
  meta?: { type?: string[] };
  timestamp?: number[];
  [key: string]: unknown;
};

export function yahooSymbol(code: string) {
  if (/^(5|6)/.test(code)) return `${code}.SS`;
  if (/^(0|3)/.test(code)) return `${code}.SZ`;
  if (/^(4|8)/.test(code)) return `${code}.BJ`;
  return `${code}.SZ`;
}

export function tencentSymbol(code: string) {
  if (/^(5|6)/.test(code)) return `sh${code}`;
  if (/^(4|8)/.test(code)) return `bj${code}`;
  return `sz${code}`;
}

export function resolveStock(query: string) {
  const clean = query.trim();
  if (/^\d{6}$/.test(clean)) {
    return { code: clean, name: STOCK_NAMES[clean] ?? clean };
  }

  const match = Object.entries(STOCK_NAMES).find(([, name]) =>
    name.includes(clean) || clean.includes(name)
  );
  return match ? { code: match[0], name: match[1] } : null;
}

export function parseStockSuggestions(content: string) {
  const match = content.match(/^v_hint="([\s\S]*)";?\s*$/);
  if (!match || match[1] === "N") return [];

  let decoded = "";
  try {
    decoded = JSON.parse(`"${match[1]}"`) as string;
  } catch {
    return [];
  }

  return decoded.split("^").flatMap((item) => {
    const [market, code, name, , type] = item.split("~");
    if (!["sh", "sz", "bj"].includes(market) || !/^\d{6}$/.test(code) || !type?.startsWith("GP-A")) {
      return [];
    }
    return [{ code, name }];
  });
}

async function searchStockByName(query: string) {
  try {
    const url = `https://smartbox.gtimg.cn/s3/?q=${encodeURIComponent(query)}&t=all`;
    const response = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 StockReviewAssistant/1.0" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return null;

    const suggestions = parseStockSuggestions(await response.text());
    const exact = suggestions.find((item) => item.name.toLowerCase() === query.toLowerCase());
    return exact ?? suggestions[0] ?? null;
  } catch {
    return null;
  }
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function movingAverage(values: number[], window: number, index: number) {
  if (index + 1 < window) return null;
  return average(values.slice(index + 1 - window, index + 1));
}

function buildHistory(rows: Array<{
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}>) {
  const closes = rows.map((row) => row.close);
  return rows.map((row, index) => ({
    ...row,
    ma5: movingAverage(closes, 5, index),
    ma20: movingAverage(closes, 20, index),
    ma60: movingAverage(closes, 60, index),
  }));
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 StockReviewAssistant/1.0" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new Error(`数据源返回 ${response.status}`);
  }
  try {
    return await response.json() as Promise<T>;
  } catch {
    throw new Error("数据源返回内容无法解析，可能是接口限流，请稍后重试");
  }
}

async function getChart(code: string) {
  const symbol = yahooSymbol(code);
  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=6mo&interval=1d`;

  try {
    const data = await fetchJson<YahooChart>(yahooUrl);
    const result = data.chart?.result?.[0];
    const quote = result?.indicators?.quote?.[0];
    const rows = (result?.timestamp ?? []).flatMap((timestamp, index) => {
      const close = quote?.close?.[index];
      if (!Number.isFinite(close)) return [];
      return [{
        date: new Date(timestamp * 1000).toISOString().slice(0, 10),
        open: Number(quote?.open?.[index] ?? close),
        high: Number(quote?.high?.[index] ?? close),
        low: Number(quote?.low?.[index] ?? close),
        close: Number(close),
        volume: Number(quote?.volume?.[index] ?? 0),
      }];
    });
    if (!result || rows.length < 20) throw new Error("Yahoo行情不足");
    const history = buildHistory(rows);
    const closes = history.map((row) => row.close);
    return {
      history,
      currentPrice: result.meta?.regularMarketPrice ?? closes.at(-1) ?? 0,
      previousClose: closes.at(-2) ?? result.meta?.chartPreviousClose ?? closes.at(-1) ?? 0,
      marketTime: result.meta?.regularMarketTime
        ? new Date(result.meta.regularMarketTime * 1000).toISOString()
        : null,
      sourceName: "Yahoo Finance公开行情",
      sourceUrl: `https://finance.yahoo.com/quote/${symbol}`,
    };
  } catch {
    const tencentCode = tencentSymbol(code);
    const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${tencentCode},day,,,120,qfq`;
    const data = await fetchJson<{
      data?: Record<string, { qfqday?: string[][]; day?: string[][] }>;
    }>(url);
    const rows = data.data?.[tencentCode]?.qfqday ?? data.data?.[tencentCode]?.day ?? [];
    const validRows = rows.filter((row) => row.length >= 5 && Number.isFinite(Number(row[2])));
    if (validRows.length < 20) throw new Error("公开行情暂时不可用，请稍后重试");
    const history = buildHistory(validRows.map((row) => ({
      date: row[0],
      open: Number(row[1]),
      close: Number(row[2]),
      high: Number(row[3]),
      low: Number(row[4]),
      volume: Number(row[5] ?? 0),
    })));
    const closes = history.map((row) => row.close);
    return {
      history,
      currentPrice: closes.at(-1) ?? 0,
      previousClose: closes.at(-2) ?? closes.at(-1) ?? 0,
      marketTime: `${validRows.at(-1)?.[0]}T15:00:00+08:00`,
      sourceName: "腾讯证券公开行情",
      sourceUrl: `https://gu.qq.com/${tencentCode}`,
    };
  }
}

async function getFundamentals(symbol: string) {
  const now = Math.floor(Date.now() / 1000);
  const start = now - 60 * 60 * 24 * 365 * 3;
  const types = [
    "quarterlyTotalRevenue",
    "quarterlyNetIncome",
    "quarterlyTotalAssets",
    "quarterlyTotalDebt",
  ].join(",");
  const url = `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${symbol}?symbol=${symbol}&type=${types}&period1=${start}&period2=${now}`;

  try {
    const data = await fetchJson<{ timeseries?: { result?: FundamentalSeries[] } }>(url);
    const rows: Record<string, Array<{ date: string; value: number }>> = {};

    for (const series of data.timeseries?.result ?? []) {
      const type = series.meta?.type?.[0];
      if (!type) continue;
      const values = series[type] as Array<{ asOfDate?: string; reportedValue?: { raw?: number } }> | undefined;
      rows[type] = (values ?? [])
        .filter((value) => Number.isFinite(value.reportedValue?.raw))
        .map((value) => ({
          date: value.asOfDate ?? "",
          value: value.reportedValue?.raw ?? 0,
        }))
        .slice(-5);
    }
    return rows;
  } catch {
    return {};
  }
}

function growth(series: Array<{ value: number }> | undefined) {
  if (!series || series.length < 2) return null;
  const previous = series.at(-2)?.value ?? 0;
  const current = series.at(-1)?.value ?? 0;
  return previous ? ((current - previous) / Math.abs(previous)) * 100 : null;
}

type ProfileSummary = {
  name: string | null;
  marketCap: number | null;
  pe: number | null;
  pb: number | null;
  roe: number | null;
  grossMargin: number | null;
  profitMargin: number | null;
  operatingCashflow: number | null;
  sector: string | null;
  industry: string | null;
  businessSummary: string | null;
};

async function getQuoteSummary(symbol: string): Promise<ProfileSummary> {
  const empty: ProfileSummary = {
    name: null, marketCap: null, pe: null, pb: null, roe: null,
    grossMargin: null, profitMargin: null, operatingCashflow: null,
    sector: null, industry: null, businessSummary: null,
  };
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=price,defaultKeyStatistics,financialData,assetProfile`;
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 StockReviewAssistant/1.0" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return empty;
    const data = await res.json() as {
      quoteSummary?: { result?: Array<{
        price?: { marketCap?: { raw?: number }; trailingPE?: { raw?: number }; priceToBook?: { raw?: number }; shortName?: string; longName?: string };
        financialData?: { returnOnEquity?: { raw?: number }; grossMargins?: { raw?: number }; profitMargins?: { raw?: number }; operatingCashflow?: { raw?: number } };
        assetProfile?: { industry?: string; sector?: string; longBusinessSummary?: string };
      }> | null };
    };
    const result = data.quoteSummary?.result?.[0];
    if (!result) return empty;
    const num = (value?: { raw?: number }) => (typeof value?.raw === "number" ? value.raw : null);
    return {
      name: result.price?.longName || result.price?.shortName || null,
      marketCap: num(result.price?.marketCap),
      pe: num(result.price?.trailingPE),
      pb: num(result.price?.priceToBook),
      roe: num(result.financialData?.returnOnEquity),
      grossMargin: num(result.financialData?.grossMargins),
      profitMargin: num(result.financialData?.profitMargins),
      operatingCashflow: num(result.financialData?.operatingCashflow),
      sector: result.assetProfile?.sector ?? null,
      industry: result.assetProfile?.industry ?? null,
      businessSummary: result.assetProfile?.longBusinessSummary ?? null,
    };
  } catch {
    return empty;
  }
}

const THEME_HINTS: Record<string, string[]> = {
  "白酒": ["白酒", "消费"],
  "电池": ["新能源", "锂电池"],
  "半导体设备": ["半导体", "国产替代"],
  "新能源汽车": ["新能源车", "锂电池"],
  "动力电池": ["新能源", "锂电池"],
  "人工智能软件": ["人工智能", "信创"],
  "创新药": ["创新药", "医药"],
  "银行": ["金融", "高股息"],
  "保险": ["金融", "高股息"],
  "黄金·有色": ["黄金", "有色金属"],
  "AI服务器": ["人工智能", "算力"],
  "光通信": ["人工智能", "算力", "光模块"],
  "PCB·AI算力": ["人工智能", "PCB", "算力"],
  "国产算力芯片": ["半导体", "国产替代", "人工智能"],
  "AI芯片": ["半导体", "人工智能"],
  "半导体制造": ["半导体", "国产替代"],
  "互联网金融": ["金融", "互联网"],
  "办公软件": ["信创", "软件"],
  "家用电器": ["消费", "家电"],
  "新能源整车": ["新能源车", "锂电池"],
  "化学制药": ["医药", "化学制药"],
  "医疗服务": ["医药", "医疗服务"],
  "医疗器械": ["医药", "医疗器械"],
  "乳制品": ["消费", "食品饮料"],
  "工程机械": ["高端制造", "基建"],
};

export async function analyzeStockData(query: string) {
  const clean = query.trim();
  const stock = resolveStock(clean) ?? await searchStockByName(clean);
  if (!stock) {
    throw new Error("暂时无法按名称识别这只股票，请输入6位股票代码");
  }

  const symbol = yahooSymbol(stock.code);
  const fund = ETF_PROFILES[stock.code] ?? null;
  const chart = await getChart(stock.code);
  const { history, currentPrice, previousClose } = chart;
  const closes = history.map((row) => row.close);
  const highs = history.map((row) => row.high);
  const lows = history.map((row) => row.low);
  const recent20 = closes.slice(-20);
  const recent60 = closes.slice(-60);
  const dailyMoves = closes.slice(1).map((value, index) =>
    closes[index] ? Math.abs((value - closes[index]) / closes[index]) * 100 : 0
  );
  const support = Math.min(...lows.slice(-20));
  const resistance = Math.max(...highs.slice(-60));
  const riskPerShare = Math.max(currentPrice - support, currentPrice * 0.03);
  const [fundamentals, profile] = await Promise.all([
    getFundamentals(symbol),
    getQuoteSummary(symbol),
  ]);
  const revenueGrowth = growth(fundamentals.quarterlyTotalRevenue);
  const profitGrowth = growth(fundamentals.quarterlyNetIncome);
  const assets = fundamentals.quarterlyTotalAssets?.at(-1)?.value ?? 0;
  const debt = fundamentals.quarterlyTotalDebt?.at(-1)?.value ?? 0;
  const debtRatio = assets ? (debt / assets) * 100 : null;

  const resolvedName = STOCK_NAMES[stock.code] ?? profile.name ?? stock.name;
  const resolvedIndustry = INDUSTRIES[stock.code] ?? profile.industry ?? profile.sector ?? "行业信息待补充";

  return {
    stock: {
      code: stock.code,
      name: resolvedName,
      industry: resolvedIndustry,
      instrumentType: fund ? "etf" as const : "stock" as const,
      fund,
      sector: profile.sector,
      businessSummary: profile.businessSummary,
      marketSymbol: symbol,
    },
    quote: {
      price: currentPrice,
      previousClose,
      changePercent: previousClose ? ((currentPrice - previousClose) / previousClose) * 100 : 0,
      ma5: average(closes.slice(-5)),
      ma20: average(recent20),
      ma60: average(recent60),
      recentHigh: resistance,
      recentLow: Math.min(...recent60),
      support,
      resistance,
      volatility: average(dailyMoves.slice(-20)),
      target1: currentPrice + riskPerShare,
      target2: currentPrice + riskPerShare * 2,
      marketTime: chart.marketTime,
    },
    financials: {
      revenueGrowth,
      profitGrowth,
      debtRatio,
      marketCap: profile.marketCap,
      pe: profile.pe,
      pb: profile.pb,
      roe: profile.roe,
      grossMargin: profile.grossMargin,
      profitMargin: profile.profitMargin,
      operatingCashflow: profile.operatingCashflow,
      series: fundamentals,
    },
    history: history.slice(-90),
    volumeHighlight: history.length
      ? history.reduce((largest, row) => row.volume > largest.volume ? row : largest)
      : null,
    source: {
      name: chart.sourceName,
      url: chart.sourceUrl,
      fetchedAt: new Date().toISOString(),
    },
  };
}

export function automaticExplanation(data: Awaited<ReturnType<typeof analyzeStockData>>) {
  const { stock, quote, financials } = data;
  const trend = quote.price >= quote.ma20 ? "近期价格位于20日均线之上" : "近期价格位于20日均线之下";
  const profitText = financials.profitGrowth === null
    ? "公开接口暂未返回可比较的利润数据"
    : `最近两期利润变化约为 ${financials.profitGrowth.toFixed(1)}%`;
  const volatilityText = quote.volatility > 3 ? "近期波动较大" : "近期波动处于相对温和区间";

  if (stock.instrumentType === "etf" && stock.fund) {
    return {
      summary: `${stock.name}跟踪${stock.fund.trackingIndex}，${trend}；近20日平均绝对涨跌幅约${quote.volatility.toFixed(2)}%。ETF价格还会受到指数表现、汇率、跟踪误差和场内折溢价影响。`,
      company: [
        `${stock.name}是${stock.fund.category}，不是单一上市公司。`,
        `跟踪标的为${stock.fund.trackingIndex}，目标是尽量减小跟踪偏离和跟踪误差。`,
        `基金管理人为${stock.fund.manager}。`,
        `在${stock.fund.exchange}交易，基金合同生效日为${stock.fund.inceptionDate}。`,
      ],
      risks: [
        "基金集中跟踪香港科技板块，指数成份股整体下跌时会承受市场风险。",
        "作为QDII产品，人民币与港币等汇率变化可能影响基金回报。",
        "内地与香港交易日、交易时段不同，场内价格可能出现折价或溢价。",
        "基金表现可能因费用、申赎和复制方式与标的指数存在跟踪偏离。",
        `近20日平均绝对涨跌幅约 ${quote.volatility.toFixed(2)}%，请结合自己的承受能力设置计划。`,
      ],
      themes: [
        { name: stock.fund.trackingIndex, confidence: "已核验", reason: "基金产品资料明确列示的标的指数。" },
        { name: "跨境指数投资", confidence: "已核验", reason: `${stock.fund.category}，主要风险来自指数、汇率和跨市场交易差异。` },
      ],
      missingInformation: [
        "最新基金净值与场内折溢价",
        "最新基金规模、份额和跟踪误差",
        "最新成份股持仓与权重",
      ],
    };
  }

  const themeSet = new Set<string>();
  const builtThemes: Array<{ name: string; confidence: string; reason: string }> = [];
  const pushTheme = (name: string, confidence: string, reason: string) => {
    if (!name || themeSet.has(name)) return;
    themeSet.add(name);
    builtThemes.push({ name, confidence, reason });
  };
  if (stock.industry && stock.industry !== "行业信息待补充") {
    pushTheme(stock.industry, "较强", `${stock.name}主营所属行业为${stock.industry}。`);
  }
  if (stock.sector) {
    pushTheme(stock.sector, "中", `所属板块分类为${stock.sector}。`);
  }
  for (const hint of THEME_HINTS[stock.industry] ?? []) {
    pushTheme(hint, "待核验", `与${stock.industry}相关的常见概念题材，需以公司公告为准。`);
  }
  if (builtThemes.length === 0) {
    pushTheme(stock.industry || "待补充", "待核验", "暂无题材信息，建议结合公告核验。");
  }

  const company = [
    `${stock.name}的行业分类为${stock.industry}。`,
    `当前公开数据代码为${stock.code}，行情使用不需要账号的公开接口获取。`,
    "公司具体业务与客户结构需要结合最新年报和官方公告继续核验。",
  ];
  if (stock.sector) {
    company.push(`所属板块分类为${stock.sector}。`);
  }

  return {
    summary: `${stock.name}属于${stock.industry}，${trend}，${volatilityText}。先检查基本面变化，再结合自己能承受的亏损设置计划。`,
    company,
    risks: [
      profitText,
      `20日平均日波动约 ${quote.volatility.toFixed(2)}%，价格提醒可能被短期波动触发。`,
      "免费公开行情可能延迟，重要止损必须同时在券商App设置。",
    ],
    themes: builtThemes,
    missingInformation: [
      financials.revenueGrowth === null ? "营收可比数据" : "",
      financials.profitGrowth === null ? "利润可比数据" : "",
      "公司最新公告与管理层说明",
    ].filter(Boolean),
  };
}
