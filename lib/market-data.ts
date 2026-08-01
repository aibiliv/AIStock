/**
 * MarketDataProvider —— 统一行情数据入口（多级降级）。
 *
 * 设计目标：把"从哪取数"收敛到一处，对外只暴露 getRealtime / getKlines /
 * getProfile 等稳定接口；内部按优先级依次尝试多个【免费公开】数据源，任一成功即返回。
 *
 * 可用数据源（在 Cloudflare Workers 运行时均可用，仅需 fetch）：
 *   1) 东方财富 push2 / push2his —— 主源（个股实时、历史K线、PE/PB、市值、概念板块、资金流）
 *   2) 腾讯证券 / 新浪财经 —— 东方财富的后备（实时行情与K线）
 *   3) 麦蕊（可选增强层，仅配置 token）—— ROE/净利/行业/简介等基本面深度字段
 *
 * 关于描述中另两家数据源在「本项目实际运行时」的可行性：
 *   - AKShare（_em 分支）：它本身不是数据源，只是抓取东方财富/新浪/交易所官网的公开网页接口。
 *     本项目用 fetch 直接复刻其 _em 系列底层端点（概念板块=stock_board_concept_name_em、
 *     资金流=stock_individual_fund_flow 等），等效且不依赖 Python 运行时。✅ 可用
 *   - 通达信 pytdx（直连 115.238.56.198:7709 等）：走的是二进制 TCP 私有协议，
 *     Cloudflare Workers 运行时没有可对任意主机发起原生 TCP 的能力，无法直接直连。❌ 当前运行时不可用
 *     若改在 Docker/Node 部署并起一个 Python 侧车代理，可后续把 TDX 作为更高优先级层接入；
 *     当前用腾讯/新浪代替它承担"后备实时行情"的角色。见文件底部 TDX_SUPPORTED / tdxNote。
 */

const UA = "Mozilla/5.0 (compatible; AIStock/1.0)";
const TIMEOUT = 10_000;

// 麦蕊（商业付费 API）作为「可选增强层」：仅当配置了 MAIRUI_TOKEN 时启用，
// 作为实时行情 / 基本面的更高优先级源；无 token 时自动走下方免费多级降级链。
// 启用时若失败（额度耗尽 / 网络错 / 字段缺失）一律静默降级回免费源，不影响主流程。
import { getMairuiRealtime, getMairuiFundamentals, isMairuiEnabled } from "./mairui";

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { "user-agent": UA },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function fetchText(url: string, headers: Record<string, string> = {}): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": UA, ...headers },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** 东方财富 secid：上交所(5/6/9 开头)=1，深交所/北交所=0 */
function eastmoneySecid(code: string): string {
  if (/^(5|6|9)/.test(code)) return `1.${code}`;
  return `0.${code}`;
}

/** 6 位代码 → 腾讯符号（如 600000→sh600000） */
export function tencentSymbol(code: string): string {
  if (/^\d{6}$/.test(code)) {
    const prefix = code.startsWith("6") || code.startsWith("9") ? "sh" : "sz";
    return `${prefix}${code}`;
  }
  return code;
}

// ---------------------------------------------------------------------------
// 对外类型
// ---------------------------------------------------------------------------

export type RealtimeQuote = {
  code: string;
  name: string | null;
  price: number;
  previousClose: number | null;
  changePercent: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  sourceName: string;
  sourceUrl: string;
};

export type KlineRow = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type KlineResult = {
  rows: KlineRow[];
  sourceName: string;
  sourceUrl: string;
};

export type StockProfile = {
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

export type FundFlow = {
  code: string;
  mainNetInflow: number | null;
  sourceName: string;
};

export type ConceptBoard = {
  code: string;
  name: string;
};

// ---------------------------------------------------------------------------
// 实时行情：东方财富 → 腾讯 → 新浪
// ---------------------------------------------------------------------------

async function eastmoneyRealtime(code: string): Promise<RealtimeQuote> {
  const secid = eastmoneySecid(code);
  const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f44,f45,f46,f57,f58,f60&invt=2&fltt=2&_=${Date.now()}`;
  const data = await fetchJson<{ data?: Record<string, string | null> }>(url);
  const d = data.data;
  if (!d) throw new Error("东方财富实时无数据");
  const price = num(d.f43);
  if (price === null) throw new Error("东方财富实时价格缺失");
  const previousClose = num(d.f60);
  const changePercent = previousClose ? ((price - previousClose) / previousClose) * 100 : null;
  return {
    code,
    name: typeof d.f58 === "string" && d.f58 ? d.f58 : null,
    price,
    previousClose,
    changePercent,
    open: num(d.f46),
    high: num(d.f44),
    low: num(d.f45),
    sourceName: "东方财富实时行情",
    sourceUrl: `https://quote.eastmoney.com/${secid}.html`,
  };
}

async function tencentRealtime(code: string): Promise<RealtimeQuote> {
  const ts = tencentSymbol(code);
  const text = await fetchText(`https://qt.gtimg.cn/q=${ts}`);
  const m = text.match(/="([^"]*)"/);
  if (!m) throw new Error("腾讯实时解析失败");
  const parts = m[1].split("~");
  const price = num(parts[3]);
  if (price === null) throw new Error("腾讯实时价格缺失");
  const previousClose = num(parts[4]);
  const changePercent = num(parts[32]);
  return {
    code,
    name: parts[1] || null,
    price,
    previousClose,
    changePercent,
    open: num(parts[5]),
    high: num(parts[33]),
    low: num(parts[34]),
    sourceName: "腾讯证券实时行情",
    sourceUrl: `https://gu.qq.com/${ts}`,
  };
}

async function sinaRealtime(code: string): Promise<RealtimeQuote> {
  const ts = tencentSymbol(code);
  const text = await fetchText(`https://hq.sinajs.cn/list=${ts}`, {
    Referer: "https://finance.sina.com.cn",
  });
  const m = text.match(/="([^"]*)"/);
  if (!m) throw new Error("新浪实时解析失败");
  const parts = m[1].split(",");
  const price = num(parts[3]);
  if (price === null) throw new Error("新浪实时价格缺失");
  const previousClose = num(parts[2]);
  const changePercent = previousClose ? ((price - previousClose) / previousClose) * 100 : null;
  return {
    code,
    name: parts[0] || null,
    price,
    previousClose,
    changePercent,
    open: num(parts[1]),
    high: num(parts[4]),
    low: num(parts[5]),
    sourceName: "新浪财经实时行情",
    sourceUrl: `https://finance.sina.com.cn/realstock/company/${ts}/nc.shtml`,
  };
}

/** 实时行情，多级降级；全部失败返回 null（调用方应回退到历史K线推算值）。
 * 优先级：麦蕊（仅配置 MAIRUI_TOKEN 时）→ 东方财富 → 腾讯 → 新浪。 */
export async function getRealtime(code: string): Promise<RealtimeQuote | null> {
  if (await isMairuiEnabled()) {
    try {
      const m = await getMairuiRealtime(code);
      if (m && m.price !== null) {
        return {
          code,
          name: m.name,
          price: m.price,
          previousClose: m.previousClose,
          changePercent: m.changePercent,
          open: null,
          high: null,
          low: null,
          sourceName: "麦蕊实时行情",
          sourceUrl: `https://www.mairuiapi.com`,
        };
      }
    } catch {
      // 麦蕊异常：降级到免费源
    }
  }
  for (const provider of [eastmoneyRealtime, tencentRealtime, sinaRealtime]) {
    try {
      return await provider(code);
    } catch {
      // 尝试下一个数据源
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 历史 K 线：东方财富 → 腾讯
// ---------------------------------------------------------------------------

async function eastmoneyKlines(code: string): Promise<KlineResult> {
  const secid = eastmoneySecid(code);
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&klt=101&fqt=1&beg=0&end=20500101&lmt=900&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56`;
  const data = await fetchJson<{ data?: { klines?: string[] } }>(url);
  const rows = (data.data?.klines ?? [])
    .map((line) => line.split(","))
    .filter((c) => c.length >= 6 && Number.isFinite(Number(c[2])))
    .map((c) => ({
      date: c[0],
      open: Number(c[1]),
      close: Number(c[2]),
      high: Number(c[3]),
      low: Number(c[4]),
      volume: Number(c[5] ?? 0),
    }));
  if (rows.length < 20) throw new Error("东方财富K线不足");
  return { rows, sourceName: "东方财富历史K线", sourceUrl: `https://quote.eastmoney.com/${secid}.html` };
}

async function tencentKlines(code: string): Promise<KlineResult> {
  const ts = tencentSymbol(code);
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${ts},day,,,800,qfq`;
  const data = await fetchJson<{ data?: Record<string, { qfqday?: string[][]; day?: string[][] }> }>(url);
  const rowsRaw = data.data?.[ts]?.qfqday ?? data.data?.[ts]?.day ?? [];
  const rows = rowsRaw
    .filter((r) => r.length >= 5 && Number.isFinite(Number(r[2])))
    .map((r) => ({
      date: r[0],
      open: Number(r[1]),
      close: Number(r[2]),
      high: Number(r[3]),
      low: Number(r[4]),
      volume: Number(r[5] ?? 0),
    }));
  if (rows.length < 20) throw new Error("腾讯K线不足");
  return { rows, sourceName: "腾讯证券历史K线", sourceUrl: `https://gu.qq.com/${ts}` };
}

/** 历史日K，多级降级；全部失败抛错。 */
export async function getKlines(code: string): Promise<KlineResult> {
  let lastError: unknown;
  for (const provider of [eastmoneyKlines, tencentKlines]) {
    try {
      return await provider(code);
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(lastError instanceof Error ? lastError.message : "公开行情暂时不可用，请稍后重试");
}

// ---------------------------------------------------------------------------
// 基本面：东方财富(名称/市值/PE/PB) + 麦蕊(可选,ROE/净利/行业/简介) + 东财f100(行业/简介兜底)
// ---------------------------------------------------------------------------

async function eastmoneyProfile(code: string): Promise<Partial<StockProfile>> {
  const secid = eastmoneySecid(code);
  const fields = "f43,f44,f45,f46,f57,f58,f60,f116,f162,f167";
  const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=${fields}&invt=2&_=${Date.now()}`;
  try {
    const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok) return {};
    const data = await res.json() as { data?: Record<string, string | null> };
    const d = data.data;
    if (!d) return {};
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

/** 东方财富「基本资料」(f100) 兜底：在国内环境稳定可用，提供行业与主营业务简介，
 * 作为麦蕊未配置时的行业/简介兜底。 */
async function eastmoneyF100Profile(code: string): Promise<Partial<StockProfile>> {
  const secid = eastmoneySecid(code);
  const url = `https://emweb.securities.eastmoney.com/PC_HSF10/BusinessAnalysis/PageAjax?code=${secid}`;
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, Referer: "https://emweb.securities.eastmoney.com/" }, signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok) return {};
    const data = await res.json() as {
      MainBusiness?: Array<{ MAINOP_TYPE_NAME?: string; MAINOP_BUSINESS?: string }>;
    };
    const main = data.MainBusiness ?? [];
    const industry = main.find((item) => item.MAINOP_TYPE_NAME === "行业")?.MAINOP_BUSINESS?.trim() || null;
    const businessSummary = main
      .map((item) => `${item.MAINOP_TYPE_NAME ?? ""}:${item.MAINOP_BUSINESS ?? ""}`)
      .slice(0, 4)
      .join("；") || null;
    return { industry, businessSummary };
  } catch {
    return {};
  }
}

/** 基本面资料。
 * 东方财富对 A 股的名称/总市值/PE/PB 更可靠优先；
 * roe/profitMargin/businessSummary/industry 优先用麦蕊（仅配置 token 时），否则回退东方财富 f100。
 * （历史上 Yahoo 也参与兜底，但其在 Cloudflare Workers 国内环境基本不可达、且会拖慢请求，已移除。） */
export async function getProfile(code: string): Promise<StockProfile> {
  const mairuiEnabled = await isMairuiEnabled();
  const [em, mairui, emF100] = await Promise.all([
    eastmoneyProfile(code),
    mairuiEnabled ? getMairuiFundamentals(code) : Promise.resolve(null),
    eastmoneyF100Profile(code),
  ]);
  return {
    name: em.name,
    marketCap: em.marketCap,
    pe: em.pe,
    pb: em.pb,
    // 麦蕊(配置 token 时)提供 roe/profitMargin；grossMargin/operatingCashflow/sector
    // 原由 Yahoo 提供，移除 Yahoo 后免费链路无稳定源，退化为 null（有 token 时麦蕊仍覆盖 roe/净利率）。
    roe: mairui?.roe ?? null,
    grossMargin: null,
    profitMargin: mairui?.profitMargin ?? null,
    operatingCashflow: null,
    sector: null,
    // 行业/简介：麦蕊优先 → 东方财富 f100 兜底（国内稳定）
    industry: mairui?.industry ?? emF100.industry ?? null,
    businessSummary: mairui?.businessSummary ?? emF100.businessSummary ?? null,
  };
}

// ---------------------------------------------------------------------------
// AKShare(_em 分支) 等效端点：概念板块、个股资金流
// ---------------------------------------------------------------------------

/** 概念板块列表（等效于 AKShare stock_board_concept_name_em，底层即东方财富公开接口）。 */
export async function conceptBoards(): Promise<ConceptBoard[]> {
  const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=500&fs=m:90+t:3&fields=f12,f14`;
  const data = await fetchJson<{ data?: { diff?: Array<{ f12?: string; f14?: string }> } }>(url);
  const diff = data.data?.diff ?? [];
  return diff
    .filter((d) => d.f12 && d.f14)
    .map((d) => ({ code: d.f12 as string, name: d.f14 as string }));
}

/** 个股主力资金净流入（等效于 AKShare stock_individual_fund_flow，底层即东方财富公开接口）。 */
export async function fundFlow(code: string): Promise<FundFlow> {
  const secid = eastmoneySecid(code);
  const url = `https://push2.eastmoney.com/api/qt/stock/fflow/daykline/get?lmt=1&klt=101&secid=${secid}&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65`;
  const data = await fetchJson<{ data?: { klines?: string[] } }>(url);
  const last = data.data?.klines?.at(-1);
  if (!last) throw new Error("资金流数据缺失");
  const cells = last.split(",");
  // f52 = 主力净流入额（元）
  return { code, mainNetInflow: num(cells[1] ?? ""), sourceName: "东方财富资金流(akshare_em)" };
}

// ---------------------------------------------------------------------------
// 大盘指数（东方财富批量接口，见 lib/indices.ts）
// ---------------------------------------------------------------------------

export { getIndexQuotes } from "./indices";

// ---------------------------------------------------------------------------
// 通达信（pytdx）状态说明：当前 Workers 运行时不可用
// ---------------------------------------------------------------------------

export const TDX_SUPPORTED = false;

export function tdxNote(): string {
  return [
    "通达信(pytdx)直连行情服务器走二进制 TCP 私有协议，Cloudflare Workers 运行时",
    "无法对任意主机发起原生 TCP 连接，故当前不可用于直连。",
    "若部署在 Docker/Node 并起一个 Python 侧车代理，可把 TDX 作为更高优先级层接入",
    "（实时行情与财务数据的后备）；当前由腾讯/新浪承担其后备角色。",
  ].join("");
}
