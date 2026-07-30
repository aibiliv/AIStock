import A_STOCK_LIST from "../db/a_stock_list";
import { USER_FUND_PROFILES } from "../db/funds_user";
import { getMairuiRealtime, getMairuiFundamentals } from "./mairui";

export type FundProfile = {
  name: string;
  manager: string;
  trackingIndex: string;
  exchange: string;
  category: string;
  inceptionDate: string;
  sourceName?: string;
  sourceUrl?: string;
};

// 内置基金资料（硬编码的少数示例）。用户自己的基金请登记在 db/funds_user.ts，
// 合并后用户登记优先（可覆盖内置同名基金），重新部署即可生效。
const BUILTIN_FUND_PROFILES: Record<string, FundProfile> = {
  "513180": {
    name: "华夏恒生科技ETF",
    manager: "华夏基金管理有限公司",
    trackingIndex: "恒生科技指数",
    exchange: "上海证券交易所",
    category: "跨境股票指数ETF（QDII）",
    inceptionDate: "2021-05-18",
    sourceName: "华夏基金",
    sourceUrl: "https://www.chinaamc.com.cn/fund/513180/index.shtml",
  },
  "159583": {
    name: "富国中证通信设备主题ETF",
    manager: "富国基金管理有限公司",
    trackingIndex: "中证通信设备主题指数",
    exchange: "深圳证券交易所",
    category: "股票型指数ETF",
    inceptionDate: "2024-06-28",
    sourceName: "富国基金",
    sourceUrl: "https://www.fullgoal.com.cn/fundDetail/159583/index.html",
  },
};

// 合并表：内置 + 用户登记。任何基金代码命中即可走精细分析文案，录入时自动带出名称。
export const FUND_PROFILES: Record<string, FundProfile> = {
  ...BUILTIN_FUND_PROFILES,
  ...USER_FUND_PROFILES,
};

// 股票名称 → 代码 反查表，供本地常用名称直接解析（避免每次都走腾讯接口）。
const A_STOCK_NAME_TO_CODE: Record<string, string> = {};
for (const [code, name] of Object.entries(A_STOCK_LIST)) {
  if (!(name in A_STOCK_NAME_TO_CODE)) {
    A_STOCK_NAME_TO_CODE[name] = code;
  }
}

export function isEtfCode(code: string) {
  return Boolean(FUND_PROFILES[code]);
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

// 仅用于把基金/ETF 与股票区分开，不影响能否分析：A_STOCK_LIST 是股票列表，
// 只用来快速解析名称/代码，列表里没有（如基金、未收录股）仍允许分析。
export function isFundCode(code: string): boolean {
  const c = code.trim();
  return /^5\d{5}$/.test(c) || /^1[56]\d{4}$/.test(c);
}

export function resolveStock(query: string) {
  const clean = query.trim();
  if (/^\d{6}$/.test(clean)) {
    // 基金代码优先返回产品名称，普通股票走本地全量列表，兜底用代码本身
    const etf = FUND_PROFILES[clean];
    if (etf) return { code: clean, name: etf.name };
    return { code: clean, name: A_STOCK_LIST[clean] ?? clean };
  }

  // 本地常用股票名称直接解析，找不到再交给腾讯 smartbox API
  const code = A_STOCK_NAME_TO_CODE[clean];
  if (code) return { code, name: clean };
  for (const [code, etf] of Object.entries(FUND_PROFILES)) {
    if (etf.name === clean) return { code, name: clean };
  }
  return null;
}

// 从内置全量 A 股列表解析官方股票名称（查不到时回退到调用方提供的名称）。
// 用于录入类接口，保证数据库里存储的名称与权威列表一致，避免用户手填的错字。
export function stockNameFromList(code: string): string | undefined {
  return A_STOCK_LIST[code];
}

export function canonicalStockName(code: string, fallback: string = code): string {
  if (A_STOCK_LIST[code]) return A_STOCK_LIST[code];
  if (FUND_PROFILES[code]) return FUND_PROFILES[code].name;
  return fallback;
}

export type ChartRow = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ma5: number | null;
  ma20: number | null;
  ma60: number | null;
};

// 取“加入关注以来”的基准收盘价：加入日当天或之前最近一个交易日的收盘。
// 日K按时间升序，找到最后一条 date <= 加入时间 的收盘价；若加入时间早于全部数据，退化为最早一条。
export function baseCloseSince(
  rows: Array<{ date: string; close: number }>,
  sinceDate: string,
): number | null {
  if (!rows.length) return null;
  let base: { date: string; close: number } | null = null;
  for (const row of rows) {
    if (row.date <= sinceDate) {
      base = row;
    } else {
      break;
    }
  }
  return base ? base.close : rows[0].close;
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
    const supportedType = type?.startsWith("GP-A") || type?.includes("ETF");
    if (!["sh", "sz", "bj"].includes(market) || !/^\d{6}$/.test(code) || !supportedType) {
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

function eastmoneySecid(code: string) {
  // 东方财富 secid：上交所(60/68/9 开头)=1，深交所/北交所=0
  if (/^(5|6|9)/.test(code)) return `1.${code}`;
  return `0.${code}`;
}

async function getChart(code: string) {
  // 主源：东方财富公开行情（大陆原生、字段全、免费），失败再回退 Yahoo/腾讯
  const secid = eastmoneySecid(code);
  const emUrl = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&klt=101&fqt=1&beg=0&end=20500101&lmt=900&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56`;
  try {
    const data = await fetchJson<{ data?: { klines?: string[] } }>(emUrl);
    const rows = (data.data?.klines ?? [])
      .map((line) => line.split(","))
      .filter((cells) => cells.length >= 6 && Number.isFinite(Number(cells[2])))
      .map((cells) => ({
        date: cells[0],
        open: Number(cells[1]),
        close: Number(cells[2]),
        high: Number(cells[3]),
        low: Number(cells[4]),
        volume: Number(cells[5] ?? 0),
      }));
    if (rows.length < 20) throw new Error("东方财富行情不足");
    const history = buildHistory(rows);
    const closes = history.map((row) => row.close);
    return {
      history,
      currentPrice: closes.at(-1) ?? 0,
      previousClose: closes.at(-2) ?? closes.at(-1) ?? 0,
      marketTime: `${rows.at(-1)?.date}T15:00:00+08:00`,
      sourceName: "东方财富公开行情",
      sourceUrl: `https://quote.eastmoney.com/${secid}.html`,
    };
  } catch {
    return getChartLegacy(code);
  }
}

async function getChartLegacy(code: string) {
  const symbol = yahooSymbol(code);
  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=3y&interval=1d`;

  try {
    const data = await fetchJson<YahooChart>(yahooUrl);
    const result = data.chart?.result?.[0];
    const quote = result?.indicators?.quote?.[0];
    const rows = (result?.timestamp ?? []).flatMap((timestamp, index) => {
      const close = quote?.close?.[index];
      if (!Number.isFinite(close)) return [];
      return [{
        date: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date(timestamp * 1000)),
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
    const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${tencentCode},day,,,800,qfq`;
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

async function getEastmoneyQuote(code: string): Promise<Partial<ProfileSummary>> {
  const secid = eastmoneySecid(code);
  const fields = "f43,f44,f45,f46,f57,f58,f60,f116,f162,f167";
  const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=${fields}&invt=2&_=${Date.now()}`;
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 StockReviewAssistant/1.0" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return {};
    const data = await res.json() as { data?: Record<string, string | null> };
    const d = data.data;
    if (!d) return {};
    const num = (value?: string | null) => {
      if (value == null) return null;
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };
    const peRaw = num(d.f162);
    const pbRaw = num(d.f167);
    return {
      name: typeof d.f58 === "string" && d.f58 ? d.f58 : null,
      marketCap: num(d.f116),
      // 东财 push2 的市盈率/市净率字段为「百分之一」单位（真实值 ×100），需还原。
      pe: peRaw !== null ? peRaw / 100 : null,
      pb: pbRaw !== null ? pbRaw / 100 : null,
    };
  } catch {
    return {};
  }
}

async function getQuoteSummary(code: string): Promise<ProfileSummary> {
  const empty: ProfileSummary = {
    name: null, marketCap: null, pe: null, pb: null, roe: null,
    grossMargin: null, profitMargin: null, operatingCashflow: null,
    sector: null, industry: null, businessSummary: null,
  };
  const symbol = yahooSymbol(code);
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=price,defaultKeyStatistics,financialData,assetProfile`;
  let yahoo: ProfileSummary = empty;
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 StockReviewAssistant/1.0" },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const data = await res.json() as {
        quoteSummary?: { result?: Array<{
          price?: { marketCap?: { raw?: number }; trailingPE?: { raw?: number }; priceToBook?: { raw?: number }; shortName?: string; longName?: string };
          financialData?: { returnOnEquity?: { raw?: number }; grossMargins?: { raw?: number }; profitMargins?: { raw?: number }; operatingCashflow?: { raw?: number } };
          assetProfile?: { industry?: string; sector?: string; longBusinessSummary?: string };
        }> | null };
      };
      const result = data.quoteSummary?.result?.[0];
      if (result) {
        const num = (value?: { raw?: number }) => (typeof value?.raw === "number" ? value.raw : null);
        yahoo = {
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
      }
    }
  } catch {
    yahoo = empty;
  }
  // 东方财富对 A 股的名称/总市值/PE/PB 更可靠，优先采用；其余字段用 Yahoo
  const em = await getEastmoneyQuote(code);

  // 麦蕊财务/资料增强层：用其原生 A 股数据覆盖 Yahoo 独供字段
  // （roe / profitMargin / businessSummary / industry）。无 token / 网络错 /
  // 超额(401) 时返回 null，下方全部回退到 Yahoo，流程零影响。
  const mairuiFund = await getMairuiFundamentals(code);
  return {
    name: em.name ?? yahoo.name,
    marketCap: em.marketCap ?? yahoo.marketCap,
    pe: em.pe ?? yahoo.pe,
    pb: em.pb ?? yahoo.pb,
    roe: mairuiFund?.roe ?? yahoo.roe,
    // 麦蕊 cwzb 指标表无「毛利率率」字段，保留 Yahoo 兜底
    grossMargin: yahoo.grossMargin,
    profitMargin: mairuiFund?.profitMargin ?? yahoo.profitMargin,
    operatingCashflow: yahoo.operatingCashflow,
    sector: yahoo.sector,
    industry: mairuiFund?.industry ?? yahoo.industry,
    businessSummary: mairuiFund?.businessSummary ?? yahoo.businessSummary,
  };
}

// 关键词→概念题材 模糊匹配，覆盖全A股常见行业
const THEME_RULES: Array<{ keywords: string[]; themes: string[] }> = [
  { keywords: ["白酒", "啤酒", "黄酒", "葡萄酒", "饮料"], themes: ["白酒", "消费"] },
  { keywords: ["银行"], themes: ["金融", "高股息"] },
  { keywords: ["保险"], themes: ["金融", "高股息"] },
  { keywords: ["券商", "证券"], themes: ["金融", "券商"] },
  { keywords: ["房地产", "地产", "房产"], themes: ["房地产", "周期"] },
  { keywords: ["煤炭", "钢铁", "有色", "黄金", "稀土", "矿业", "铝", "铜", "锂矿"], themes: ["有色", "周期", "资源"] },
  { keywords: ["石油", "石化", "化工", "化学", "化肥", "农药", "涂料", "塑料", "橡胶", "化纤"], themes: ["化工", "周期"] },
  { keywords: ["电力", "发电", "水电", "火电", "核电", "风电", "光伏", "太阳能", "储能", "电网", "电气"], themes: ["新能源", "电力"] },
  { keywords: ["新能源", "锂电", "电池", "动力电池", "固态电池"], themes: ["新能源", "锂电池"] },
  { keywords: ["新能源车", "整车", "汽车", "零部件", "汽配", "轮胎"], themes: ["新能源车", "汽车"] },
  { keywords: ["半导体", "芯片", "集成电路", "晶圆", "封测", "光刻"], themes: ["半导体", "国产替代"] },
  { keywords: ["人工智能", "AI", "大模型", "机器学习", "NLP"], themes: ["人工智能", "AI"] },
  { keywords: ["算力", "服务器", "数据中心", "云计算", "IDC", "GPU"], themes: ["人工智能", "算力"] },
  { keywords: ["光通信", "光模块", "光纤", "5G", "通信"], themes: ["人工智能", "算力", "光模块"] },
  { keywords: ["软件", "SaaS", "信创", "操作系统", "数据库", "中间件", "办公"], themes: ["信创", "软件"] },
  { keywords: ["互联网", "电商", "游戏", "社交", "视频", "直播", "广告", "传媒", "出版"], themes: ["互联网", "传媒"] },
  { keywords: ["医药", "制药", "生物", "疫苗", "基因", "细胞"], themes: ["医药", "创新药"] },
  { keywords: ["医疗", "器械", "设备", "诊断", "检测", "医院", "服务", "外包", "CXO", "CRO"], themes: ["医药", "医疗器械"] },
  { keywords: ["食品", "饮料", "乳品", "调味", "零食", "预制菜", "养殖", "畜牧", "饲料", "种业", "农产品"], themes: ["消费", "食品饮料"] },
  { keywords: ["家电", "家居", "家具", "照明", "厨卫"], themes: ["消费", "家电"] },
  { keywords: ["服装", "纺织", "鞋帽", "化妆品", "零售", "百货", "超市", "免税"], themes: ["消费", "零售"] },
  { keywords: ["军工", "航空航天", "船舶", "兵器", "卫星", "导航"], themes: ["军工", "高端制造"] },
  { keywords: ["机械", "工程", "重工", "装备", "机器人", "自动化", "智能制造"], themes: ["高端制造", "基建"] },
  { keywords: ["建筑", "建材", "水泥", "玻璃", "基建", "工程"], themes: ["基建", "地产链"] },
  { keywords: ["交通", "运输", "航空", "机场", "港口", "航运", "铁路", "公路", "物流", "快递"], themes: ["交通运输", "物流"] },
  { keywords: ["环保", "水务", "燃气", "供热", "废物处理"], themes: ["环保", "公用事业"] },
  { keywords: ["教育", "培训"], themes: ["教育"] },
  { keywords: ["旅游", "酒店", "景区", "餐饮"], themes: ["消费", "旅游"] },
  { keywords: ["PCB"], themes: ["PCB", "电子"] },
  { keywords: ["消费电子", "手机", "面板", "LED", "声学", "摄像头", "可穿戴"], themes: ["消费电子"] },
];

function matchThemes(industry: string): string[] {
  if (!industry || industry === "行业信息待补充") return [];
  const lower = industry.toLowerCase();
  const found = new Set<string>();
  for (const rule of THEME_RULES) {
    if (rule.keywords.some((kw) => lower.includes(kw.toLowerCase()))) {
      for (const t of rule.themes) found.add(t);
    }
  }
  return [...found];
}

export async function analyzeStockData(query: string) {
  const clean = query.trim();
  const stock = resolveStock(clean) ?? await searchStockByName(clean);
  if (!stock) {
    throw new Error("暂时无法按名称识别这只股票，请输入6位股票代码");
  }

  const symbol = yahooSymbol(stock.code);
  const fund = FUND_PROFILES[stock.code] ?? null;
  const isFund = Boolean(fund) || isFundCode(stock.code);
  const chart = await getChart(stock.code);
  const { history, currentPrice, previousClose } = chart;

  // 麦蕊实时行情增强层（有 token 时覆盖现价/涨跌，历史 K 线仍走免费公开源以省额度）。
  // 任何缺失/失败都静默回退到由历史 K 线推算的值。
  const mairui = await getMairuiRealtime(stock.code);
  let livePrice = currentPrice;
  let livePreviousClose = previousClose;
  let liveChangePercent = previousClose ? ((currentPrice - previousClose) / previousClose) * 100 : 0;
  let realtimeName: string | null = null;
  if (mairui) {
    if (mairui.price !== null) livePrice = mairui.price;
    if (mairui.previousClose !== null) livePreviousClose = mairui.previousClose;
    if (mairui.changePercent !== null) {
      liveChangePercent = mairui.changePercent;
    } else if (livePreviousClose) {
      liveChangePercent = ((livePrice - livePreviousClose) / livePreviousClose) * 100;
    }
    realtimeName = mairui.name;
  }
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
  const riskPerShare = Math.max(livePrice - support, livePrice * 0.03);
  const [fundamentals, profile] = await Promise.all([
    getFundamentals(symbol),
    getQuoteSummary(stock.code),
  ]);
  const revenueGrowth = growth(fundamentals.quarterlyTotalRevenue);
  const profitGrowth = growth(fundamentals.quarterlyNetIncome);
  const assets = fundamentals.quarterlyTotalAssets?.at(-1)?.value ?? 0;
  const debt = fundamentals.quarterlyTotalDebt?.at(-1)?.value ?? 0;
  const debtRatio = assets ? (debt / assets) * 100 : null;

  let resolvedName = A_STOCK_LIST[stock.code] ?? profile.name ?? stock.name;
  // 基金/ETF 不在股票列表里，若行情源也没给出中文名，则用名称检索兜底（如腾讯 smartbox）
  if (isFund && (resolvedName === stock.code || !/[一-龥]/.test(resolvedName))) {
    const fallback = await searchStockByName(stock.code);
    if (fallback) resolvedName = fallback.name;
  }
  // 麦蕊实时返回的官方名称作为兜底（免费公开源没给出中文名时）
  if ((resolvedName === stock.code || !/[一-龥]/.test(resolvedName)) && realtimeName) {
    resolvedName = realtimeName;
  }
  const resolvedIndustry = profile.industry ?? profile.sector ?? "行业信息待补充";

  return {
    stock: {
      code: stock.code,
      name: resolvedName,
      industry: resolvedIndustry,
      instrumentType: isFund ? "etf" as const : "stock" as const,
      fund,
      sector: profile.sector,
      businessSummary: profile.businessSummary,
      marketSymbol: symbol,
    },
    quote: {
      price: livePrice,
      previousClose: livePreviousClose,
      changePercent: liveChangePercent,
      ma5: average(closes.slice(-5)),
      ma20: average(recent20),
      ma60: average(recent60),
      recentHigh: resistance,
      recentLow: Math.min(...recent60),
      support,
      resistance,
      volatility: average(dailyMoves.slice(-20)),
      target1: livePrice + riskPerShare,
      target2: livePrice + riskPerShare * 2,
      marketTime: chart.marketTime,
    },
    financials: {
      revenueGrowth,
      profitGrowth,
      debtRatio,
      marketCap: profile.marketCap,
      // 麦蕊实时接口不返回 pe/pb（已在 mairui.ts 标注），这里直接用 profile 兜底值
      pe: profile.pe,
      pb: profile.pb,
      roe: profile.roe,
      grossMargin: profile.grossMargin,
      profitMargin: profile.profitMargin,
      operatingCashflow: profile.operatingCashflow,
      series: fundamentals,
    },
    history: history.slice(-800),
    volume: analyzeVolume(history),
    oscillators: computeOscillators(history),
    volumeHighlight: history.length
      ? history.reduce((largest, row) => row.volume > largest.volume ? row : largest)
      : null,
    source: {
      name: mairui ? `东方财富历史K线 · 麦蕊实时行情` : chart.sourceName,
      url: chart.sourceUrl,
      fetchedAt: new Date().toISOString(),
    },
  };
}

type VolumeAnalysis = {
  latest: number;
  ma5: number;
  ma20: number;
  ratio: number | null;
  divergence: "顶背离" | "底背离" | "无明显背离" | null;
  upDaysWithVolume: number;
  downDaysWithVolume: number;
};

export function analyzeVolume(history: ChartRow[]): VolumeAnalysis {
  const volumes = history.map((row) => row.volume);
  const count = volumes.length;
  const latest = volumes[count - 1] ?? 0;
  const ma5 = count >= 5 ? average(volumes.slice(-5)) : average(volumes);
  const ma20 = count >= 20 ? average(volumes.slice(-20)) : average(volumes);
  const ratio = ma20 > 0 ? latest / ma20 : null;

  let upDaysWithVolume = 0;
  let downDaysWithVolume = 0;
  for (const row of history.slice(-20)) {
    if (row.volume > ma20) {
      if (row.close >= row.open) upDaysWithVolume += 1;
      else downDaysWithVolume += 1;
    }
  }

  let divergence: VolumeAnalysis["divergence"] = null;
  if (count >= 20 && ma20 > 0) {
    const window = history.slice(-Math.min(60, count));
    const maxClose = Math.max(...window.map((row) => row.close));
    const minClose = Math.min(...window.map((row) => row.close));
    const maxVol = Math.max(...window.map((row) => row.volume));
    const last = window[window.length - 1];
    if (last.close >= maxClose * 0.97 && last.volume < maxVol * 0.6) {
      divergence = "顶背离";
    } else if (last.close <= minClose * 1.03 && last.volume < maxVol * 0.6) {
      divergence = "底背离";
    } else {
      divergence = "无明显背离";
    }
  }

  return { latest, ma5, ma20, ratio, divergence, upDaysWithVolume, downDaysWithVolume };
}

// ---------------------------------------------------------------------------
// 摆动/动能指标：MACD、RSI、KDJ。
// 全部基于已有日K（history 的 OHLCV）本地计算，不需要额外数据源或额度。
// 设计目标：只产出「中性信号」，供 AI 作为依据之一，不直接给买卖结论。
// ---------------------------------------------------------------------------

export type MacdState = "金叉" | "死叉" | "多头" | "空头" | "无明显信号";
export type DivergenceState = "顶背离" | "底背离" | "无明显背离" | null;
export type RsiZone = "超买" | "超卖" | "中性";
export type KdjState = "金叉" | "死叉" | "超买钝化" | "超卖钝化" | "无明显信号";

export type Oscillators = {
  macd: {
    dif: number;
    dea: number;
    hist: number;
    state: MacdState;
    divergence: DivergenceState;
  } | null;
  rsi: {
    rsi6: number | null;
    rsi12: number | null;
    rsi24: number | null;
    zone: RsiZone;
  } | null;
  kdj: {
    k: number | null;
    d: number | null;
    j: number | null;
    state: KdjState;
  } | null;
};

// EMA：输入无 null 的序列，前 period-1 个位置返回 null；seed 用前 period 根均值。
function emaSeries(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = average(values.slice(0, period));
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function computeMacd(closes: number[]): Oscillators["macd"] {
  if (closes.length < 26) return null;
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const dif: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    const e12 = ema12[i];
    const e26 = ema26[i];
    dif.push(e12 === null || e26 === null ? NaN : e12 - e26);
  }
  // DIF 从第 26 根（索引 25）起才有效，从该处抽取纯净序列算 DEA(EMA9)
  const validFrom = 25;
  const validDif = dif.slice(validFrom).filter((value) => !Number.isNaN(value));
  if (validDif.length < 9) return null;
  const deaValid = emaSeries(validDif, 9);
  const dea: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = 0; i < deaValid.length; i++) {
    dea[validFrom + i] = deaValid[i];
  }

  const last = closes.length - 1;
  const dDif = dif[last];
  const dDea = dea[last];
  if (dDea === null || Number.isNaN(dDif)) return null;
  // 用容差比较 DIF 与 DEA，避免完美线性行情下 DIF≈DEA 的浮点误差误判方向
  const EPS = 1e-6;
  const hist = (dDif - dDea) * 2;
  const above = dDif - dDea > EPS;
  const below = dDea - dDif > EPS;

  let state: MacdState = above ? "多头" : below ? "空头" : "无明显信号";
  const prevDif = dif[last - 1];
  const prevDea = dea[last - 1];
  if (prevDea !== null && !Number.isNaN(prevDif)) {
    const curDiff = dDif - dDea;
    const prevDiff = prevDif - prevDea;
    if (prevDiff <= EPS && curDiff > EPS) state = "金叉";
    else if (prevDiff >= -EPS && curDiff < -EPS) state = "死叉";
  }

  // 背离：近 60 根窗口内，价格与 DIF 是否同步
  let divergence: DivergenceState = null;
  const startIdx = Math.max(validFrom, closes.length - 60);
  const windowIdx: number[] = [];
  for (let i = startIdx; i <= last; i++) {
    if (!Number.isNaN(dif[i])) windowIdx.push(i);
  }
  if (windowIdx.length >= 20) {
    const maxClose = Math.max(...windowIdx.map((i) => closes[i]));
    const minClose = Math.min(...windowIdx.map((i) => closes[i]));
    const maxDif = Math.max(...windowIdx.map((i) => dif[i]));
    const minDif = Math.min(...windowIdx.map((i) => dif[i]));
    if (closes[last] >= maxClose * 0.97 && dif[last] < maxDif * 0.9) {
      divergence = "顶背离";
    } else if (closes[last] <= minClose * 1.03 && dif[last] > minDif * 0.9) {
      divergence = "底背离";
    } else {
      divergence = "无明显背离";
    }
  }

  return { dif: dDif, dea: dDea, hist, state, divergence };
}

function computeRsi(closes: number[]): Oscillators["rsi"] {
  if (closes.length < 25) return null;
  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? -diff : 0);
  }
  const rsiValue = (period: number): number | null => {
    if (closes.length < period + 1) return null;
    const calc = (g: number, l: number) => (l === 0 ? 100 : 100 - 100 / (1 + g / l));
    let avgGain = average(gains.slice(0, period));
    let avgLoss = average(losses.slice(0, period));
    let value = calc(avgGain, avgLoss);
    for (let i = period; i < gains.length; i++) {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
      value = calc(avgGain, avgLoss);
    }
    return value;
  };
  const rsi6 = rsiValue(6);
  const rsi12 = rsiValue(12);
  const rsi24 = rsiValue(24);
  let zone: RsiZone = "中性";
  if (rsi12 !== null) {
    if (rsi12 > 70) zone = "超买";
    else if (rsi12 < 30) zone = "超卖";
  }
  return { rsi6, rsi12, rsi24, zone };
}

function computeKdj(history: ChartRow[]): Oscillators["kdj"] {
  if (history.length < 9) return null;
  const k: (number | null)[] = new Array(history.length).fill(null);
  const d: (number | null)[] = new Array(history.length).fill(null);
  const j: (number | null)[] = new Array(history.length).fill(null);
  let prevK = 50;
  let prevD = 50;
  for (let i = 8; i < history.length; i++) {
    const window = history.slice(i - 8, i + 1);
    const lowN = Math.min(...window.map((row) => row.low));
    const highN = Math.max(...window.map((row) => row.high));
    const close = history[i].close;
    const rsv = highN === lowN ? 50 : ((close - lowN) / (highN - lowN)) * 100;
    const kk = (2 / 3) * prevK + (1 / 3) * rsv;
    const dd = (2 / 3) * prevD + (1 / 3) * kk;
    const jj = 3 * kk - 2 * dd;
    k[i] = kk;
    d[i] = dd;
    j[i] = jj;
    prevK = kk;
    prevD = dd;
  }
  const last = history.length - 1;
  const lastK = k[last];
  const lastD = d[last];
  const lastJ = j[last];
  if (lastK === null || lastD === null || lastJ === null) return null;

  let state: KdjState;
  const prevKv = k[last - 1];
  const prevDv = d[last - 1];
  if (prevKv !== null && prevDv !== null) {
    const cur = lastK - lastD;
    const prev = prevKv - prevDv;
    if (prev <= 0 && cur > 0) state = "金叉";
    else if (prev >= 0 && cur < 0) state = "死叉";
    else if (lastK > 80 && lastD > 80) state = "超买钝化";
    else if (lastK < 20 && lastD < 20) state = "超卖钝化";
    else state = "无明显信号";
  } else if (lastK > 80 && lastD > 80) {
    state = "超买钝化";
  } else if (lastK < 20 && lastD < 20) {
    state = "超卖钝化";
  } else {
    state = "无明显信号";
  }
  return { k: lastK, d: lastD, j: lastJ, state };
}

export function computeOscillators(history: ChartRow[]): Oscillators {
  const closes = history.map((row) => row.close);
  return {
    macd: computeMacd(closes),
    rsi: computeRsi(closes),
    kdj: computeKdj(history),
  };
}

// 把摆动指标转成中性、可放进 summary/risks 的短句（不给出确定性买卖结论）。
export function buildOscillatorNote(o: Oscillators | null): string {
  if (!o) return "";
  const parts: string[] = [];
  if (o.macd) {
    const { state, divergence, hist } = o.macd;
    if (divergence === "顶背离") parts.push("MACD出现顶背离：价格高位但动能未同步放大，追高需谨慎");
    else if (divergence === "底背离") parts.push("MACD出现底背离：价格低位但动能有企稳迹象，关注是否止跌，但不宜直接抄底");
    else if (state === "金叉") parts.push("MACD刚金叉、红柱初现，短期动能转强");
    else if (state === "死叉") parts.push("MACD刚死叉、绿柱初现，短期动能转弱");
    else if (hist < 0) parts.push("MACD位于零轴下方，整体动能偏弱");
    else parts.push("MACD位于零轴上方，整体动能偏强");
  }
  if (o.rsi) {
    const v = o.rsi.rsi12?.toFixed(1) ?? "数据缺失";
    if (o.rsi.zone === "超买") parts.push(`RSI约${v}处于超买区，短线继续追高性价比低`);
    else if (o.rsi.zone === "超卖") parts.push(`RSI约${v}处于超卖区，超跌后易有技术性反弹但勿盲目抄底`);
  }
  if (o.kdj) {
    const { state } = o.kdj;
    if (state === "金叉") parts.push("KDJ刚金叉，短线情绪转暖");
    else if (state === "死叉") parts.push("KDJ刚死叉，短线情绪转冷");
    else if (state === "超买钝化") parts.push("KDJ在超买区钝化，强势中也可能延续，但追高需防回落");
    else if (state === "超卖钝化") parts.push("KDJ在超卖区钝化，弱势中也可能延续，抄底需等企稳信号");
  }
  return parts.join("；");
}

export function automaticExplanation(data: Awaited<ReturnType<typeof analyzeStockData>>) {
  const { stock, quote, financials } = data;
  const trend = quote.price >= quote.ma20 ? "近期价格位于20日均线之上" : "近期价格位于20日均线之下";
  const profitText = financials.profitGrowth === null
    ? "公开接口暂未返回可比较的利润数据"
    : `最近两期利润变化约为 ${financials.profitGrowth.toFixed(1)}%`;
  const volatilityText = quote.volatility > 3 ? "近期波动较大" : "近期波动处于相对温和区间";
  const oscNote = buildOscillatorNote(data.oscillators);

  if (stock.instrumentType === "etf") {
    const fund = stock.fund;
    if (fund) {
      return {
        summary: `${stock.name}跟踪${fund.trackingIndex}，${trend}；近20日平均绝对涨跌幅约${quote.volatility.toFixed(2)}%。${oscNote ? oscNote + "。" : ""}ETF价格还会受到指数表现、汇率、跟踪误差和场内折溢价影响。`,
        company: [
          `${stock.name}是${fund.category}，不是单一上市公司。`,
          `跟踪标的为${fund.trackingIndex}，目标是尽量减小跟踪偏离和跟踪误差。`,
          `基金管理人为${fund.manager}。`,
          `在${fund.exchange}交易，基金合同生效日为${fund.inceptionDate}。`,
        ],
        risks: [
          "基金集中跟踪香港科技板块，指数成份股整体下跌时会承受市场风险。",
          "作为QDII产品，人民币与港币等汇率变化可能影响基金回报。",
          "内地与香港交易日、交易时段不同，场内价格可能出现折价或溢价。",
          "基金表现可能因费用、申赎和复制方式与标的指数存在跟踪偏离。",
          `近20日平均绝对涨跌幅约 ${quote.volatility.toFixed(2)}%，请结合自己的承受能力设置计划。`,
          oscNote ? oscNote : "MACD/RSI/KDJ 等摆动指标只作技术姿态参考，不单独构成买卖依据。",
        ],
        themes: [
          { name: fund.trackingIndex, confidence: "已核验", reason: "基金产品资料明确列示的标的指数。" },
          { name: "跨境指数投资", confidence: "已核验", reason: `${fund.category}，主要风险来自指数、汇率和跨市场交易差异。` },
        ],
        missingInformation: [
          "最新基金净值与场内折溢价",
          "最新基金规模、份额和跟踪误差",
          "最新成份股持仓与权重",
        ],
      };
    }
    // 未知基金（不在本地 ETF 资料中，如未收录的 ETF/LOF）：走通用基金文案，
    // 不引用具体 trackingIndex/manager，避免误把基金当股票套行业主题。
    return {
      summary: `${stock.name}是一只基金/ETF，${trend}；近20日平均绝对涨跌幅约${quote.volatility.toFixed(2)}%。${oscNote ? oscNote + "。" : ""}基金价格会受跟踪指数表现、市场波动和场内折溢价影响。`,
      company: [
        `${stock.name}是交易型开放式基金（ETF），不是单一上市公司，净值随跟踪标的波动。`,
        "建议在基金或指数官方渠道查看最新跟踪标的、基金规模与跟踪误差。",
      ],
      risks: [
        "基金集中跟踪标的指数，指数成份股整体下跌时会承受市场风险。",
        "场内交易可能出现折价或溢价，成交价格与净值不完全一致。",
          "基金表现可能因费用、申赎和复制方式与标的指数存在跟踪偏离。",
          `近20日平均绝对涨跌幅约 ${quote.volatility.toFixed(2)}%，请结合自己的承受能力设置计划。`,
          oscNote ? oscNote : "MACD/RSI/KDJ 等摆动指标只作技术姿态参考，不单独构成买卖依据。",
        ],
      themes: [
        { name: "指数基金投资", confidence: "已核验", reason: `${stock.name}为指数型产品，风险主要来自标的与市场波动。` },
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
  for (const hint of matchThemes(stock.industry)) {
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

  const volume = data.volume;
  const volNote = volume && volume.ratio !== null
    ? volume.ratio >= 1.5
      ? `，当日量比约${volume.ratio.toFixed(2)}、明显放量`
      : volume.ratio < 0.6
        ? `，当日量比约${volume.ratio.toFixed(2)}、明显缩量`
        : ""
    : "";
  const volRisk = volume && volume.divergence === "顶背离"
    ? "量价出现顶背离：价格处于阶段高位但成交量未能跟随放大，追高需谨慎。"
    : volume && volume.divergence === "底背离"
      ? "低位缩量、抛压有衰竭迹象，关注是否止跌企稳，但不宜直接抄底。"
      : null;

  return {
    summary: `${stock.name}属于${stock.industry}，${trend}，${volatilityText}${volNote}。${oscNote ? oscNote + "。" : ""}先检查基本面变化，再结合自己能承受的亏损设置计划。`,
    company,
    risks: [
      profitText,
      `20日平均日波动约 ${quote.volatility.toFixed(2)}%，价格提醒可能被短期波动触发。`,
      "免费公开行情可能延迟，重要止损必须同时在券商App设置。",
      ...(volRisk ? [volRisk] : []),
      oscNote ? oscNote : "MACD/RSI/KDJ 等摆动指标只作技术姿态参考，不单独构成买卖依据，强趋势中可能钝化失效。",
    ],
    themes: builtThemes,
    missingInformation: [
      financials.revenueGrowth === null ? "营收可比数据" : "",
      financials.profitGrowth === null ? "利润可比数据" : "",
      "公司最新公告与管理层说明",
    ].filter(Boolean),
  };
}
