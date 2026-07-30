// 麦蕊智数（mairuiapi.com）实时行情增强层。
//
// 设计定位：作为「增强层」而非「替代层」。只在配置了 MAIRUI_TOKEN 时，
// 用其原生 A 股实时行情覆盖由东财历史 K 线推算出的现价/涨跌；
// 历史 K 线仍走免费公开源，把免费档 500 次/日的额度省下来只花在实时价上。
//
// 任何失败（无 token / 网络错误 / 字段缺失 / 额度耗尽）都静默降级回现有数据，
// 不抛异常，保证 analyzeStockData 整体流程不受影响。
//
// 注意：麦蕊返回字段命名未完全公开，下方对常见中英文键名做容错提取；
// 确切字段（实时行情路径 /hsstock/real/time/{code}/{licence}）建议拿到 token 后
// 在其 Playground 核对一次，再调整下方 pick() 的候选键。

const MAIRUI_BASE = "https://api.mairuiapi.com";
const REALTIME_TTL_MS = 5 * 60 * 1000; // 同只股票 5 分钟内不重复请求，缓解重复刷新浪费额度

export type MairuiRealtime = {
  price: number | null;
  previousClose: number | null;
  changePercent: number | null;
  pe: number | null;
  pb: number | null;
  name: string | null;
};

// 模块级缓存：减少单次进程内重复刷新对同一额度的浪费。
// 注意：Worker 多 isolate 不共享此缓存，跨请求持久缓存需用 KV/D1。
const cache = new Map<string, { ts: number; data: MairuiRealtime }>();
// 额度耗尽（401/403）后当天不再调用，避免持续触发限流。
let disabledUntil = 0;

async function getMairuiToken(): Promise<string> {
  // Worker 运行时通过 cloudflare:workers 的 env 读取（与 ai-config.ts 一致）。
  try {
    const spec = "cloudflare:workers";
    const mod = await import(spec);
    const token = (mod as { env?: Record<string, string | undefined> }).env?.MAIRUI_TOKEN;
    if (token) return token;
  } catch {
    // 非 Worker 运行时（node 测试 / 本地）回退到 process.env
  }
  return typeof process !== "undefined" ? process.env?.MAIRUI_TOKEN ?? "" : "";
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// 麦蕊返回字段命名未完全公开，这里对常见中英文键名做容错提取（大小写不敏感）。
function pick(row: Record<string, unknown>, keys: string[]): number | null {
  const lower = new Map(Object.entries(row).map(([k, v]) => [k.toLowerCase(), v]));
  for (const key of keys) {
    const value = row[key] ?? lower.get(key.toLowerCase());
    const n = num(value);
    if (n !== null) return n;
  }
  return null;
}

// 麦蕊实时行情真实字段（已用真实响应核对）：
//   pc = 现价（元，真实价，非百分之一/分单位）、up = 涨停价、dp = 跌停价、
//   pk = 最小变动价位、fv/tv = 流通/总股本、name = 名称。
//   响应里【没有】 pe/pb，也没有独立的涨跌幅字段；涨跌幅由现价-昨收推算。
//   旧候选键 p/price/zxj/pc-as-涨跌幅 是误读，会导致价格解析永远 null、
//   且把现价(1320)当成 +1320% 涨跌幅，已废弃。
function parseRealtime(row: Record<string, unknown>): MairuiRealtime {
  const price = num(row.pc) ?? pick(row, ["p", "price", "zxj", "last", "now", "current", "trade", "zkj"]);
  const previousClose = pick(row, ["yc", "preClose", "prevClose", "zcj", "yclose", "previousClose"]);
  // 麦蕊实时响应无涨跌幅字段，留 null，由调用方用 现价-昨收 推算（更稳）。
  let changePercent: number | null = null;
  if (price !== null && previousClose && previousClose !== 0) {
    changePercent = ((price - previousClose) / previousClose) * 100;
  }
  const name =
    typeof row.name === "string" && row.name ? row.name
    : typeof row.mc === "string" ? row.mc
    : null;
  // 麦蕊实时接口不返回 pe/pb（财务 pe/pb 请走 getMairuiFundamentals / cwzb），
  // 这里恒为 null，避免与兜底值混淆。
  return { price, previousClose, changePercent, pe: null, pb: null, name };
}

export async function getMairuiRealtime(code: string): Promise<MairuiRealtime | null> {
  const token = await getMairuiToken();
  if (!token) return null;
  if (Date.now() < disabledUntil) return null;

  const cached = cache.get(code);
  if (cached && Date.now() - cached.ts < REALTIME_TTL_MS) return cached.data;

  // 实时行情路径（licence 拼在末尾）。如与官方文档不符，改这一行即可。
  const url = `${MAIRUI_BASE}/hsstock/real/time/${code}/${token}`;
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 StockReviewAssistant/1.0" },
      signal: AbortSignal.timeout(6_000),
    });
    // 免费档超额：接口停用，次日（Asia/Shanghai 00:00）自动恢复。
    if (res.status === 401 || res.status === 403) {
      const now = new Date();
      const sh = new Date(now.getTime() + 8 * 3600_000);
      sh.setUTCHours(0, 0, 0, 0);
      disabledUntil = sh.getTime() + 24 * 3600_000;
      return null;
    }
    if (!res.ok) return null;
    const row = await res.json() as Record<string, unknown>;
    const data = parseRealtime(row);
    if (data.price === null) return null;
    cache.set(code, { ts: Date.now(), data });
    return data;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 财务与资料增强层（cwzb 财务指标 / gsjj 公司简介 / zg 概念树提取行业）。
// 用于覆盖 / 补充 Yahoo 独供字段（roe / profitMargin / businessSummary /
// industry）。Yahoo 在国内常被限流，麦蕊作为原生 A 股数据源更稳定。
//
// 字段真相（已用真实接口核对）：
//   cwzb.jzsy = 净资产收益率(%)、cwzb.xsjl = 销售净利率(%) —— 均为百分比数值，
//   需 ÷100 转成与 Yahoo financialData(0.x 小数) 一致的格式。
//   gsjj.desc = 公司中文简介。
//   /hszg/zg/{code}/{licence} 返回 [{code,name}]，含「申万行业」「概念」等标签。
// ---------------------------------------------------------------------------

const FUND_TTL_MS = 30 * 60 * 1000; // 财务/资料变化慢，30 分钟缓存
const fundCache = new Map<string, { ts: number; data: MairuiFundamentals }>();

export type MairuiFundamentals = {
  roe: number | null; // 净资产收益率（小数，与 Yahoo 对齐）
  profitMargin: number | null; // 销售净利率（小数）
  businessSummary: string | null; // 中文公司简介
  industry: string | null; // 行业标签（从申万行业概念提取）
};

// 麦蕊财务比率返回百分比数值，转小数以对齐 Yahoo（Yahoo financialData 为 0.x）
function pct(value: unknown): number | null {
  const n = num(value);
  if (n === null) return null;
  return n / 100;
}

function parseFinancials(rows: unknown): { roe: number | null; profitMargin: number | null } {
  if (!Array.isArray(rows) || rows.length === 0) return { roe: null, profitMargin: null };
  // cwzb 按时间倒序，[0] 为最新一期
  const latest = (rows[0] ?? {}) as Record<string, unknown>;
  return { roe: pct(latest.jzsy), profitMargin: pct(latest.xsjl) };
}

function parseCompanyProfile(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") return null;
  const desc = (obj as Record<string, unknown>).desc;
  if (typeof desc === "string") {
    const trimmed = desc.trim();
    // 简介过长会显著抬高 AI prompt token，截断到合理长度
    return trimmed.length > 0 ? trimmed.slice(0, 4000) : null;
  }
  return null;
}

function parseIndustry(rows: unknown): string | null {
  if (!Array.isArray(rows)) return null;
  // 优先取申万行业标签
  for (const r of rows) {
    const name = (r as Record<string, unknown>).name;
    if (typeof name === "string" && name.includes("申万行业")) {
      const parts = name.split("申万行业-");
      return parts[1] ?? name;
    }
  }
  // 退而求其次：任何含「行业」的标签取其末段
  for (const r of rows) {
    const name = (r as Record<string, unknown>).name;
    if (typeof name === "string" && name.includes("行业")) {
      const parts = name.split(/[-—]/);
      return parts[parts.length - 1];
    }
  }
  return null;
}

export async function getMairuiFundamentals(code: string): Promise<MairuiFundamentals | null> {
  const token = await getMairuiToken();
  if (!token) return null;
  if (Date.now() < disabledUntil) return null;

  const cacheKey = `fund:${code}`;
  const cached = fundCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < FUND_TTL_MS) return cached.data;

  const headers = { "user-agent": "Mozilla/5.0 StockReviewAssistant/1.0" };
  try {
    // 三个接口并行；code 用 6 位纯数字（已用真实接口核对，.SH 后缀反而 404）
    const [cwzbRes, gsjjRes, conceptsRes] = await Promise.all([
      fetch(`${MAIRUI_BASE}/hscp/cwzb/${code}/${token}`, { headers, signal: AbortSignal.timeout(10_000) }),
      fetch(`${MAIRUI_BASE}/hscp/gsjj/${code}/${token}`, { headers, signal: AbortSignal.timeout(10_000) }),
      fetch(`${MAIRUI_BASE}/hszg/zg/${code}/${token}`, { headers, signal: AbortSignal.timeout(10_000) }),
    ]);
    for (const res of [cwzbRes, gsjjRes, conceptsRes]) {
      if (res.status === 401 || res.status === 403) {
        const now = new Date();
        const sh = new Date(now.getTime() + 8 * 3600_000);
        sh.setUTCHours(0, 0, 0, 0);
        disabledUntil = sh.getTime() + 24 * 3600_000;
        return null;
      }
    }
    const [cwzb, gsjj, concepts] = await Promise.all([
      cwzbRes.ok ? cwzbRes.json() : Promise.resolve(null),
      gsjjRes.ok ? gsjjRes.json() : Promise.resolve(null),
      conceptsRes.ok ? conceptsRes.json() : Promise.resolve(null),
    ]);

    const fin = parseFinancials(cwzb);
    const result: MairuiFundamentals = {
      roe: fin.roe,
      profitMargin: fin.profitMargin,
      businessSummary: parseCompanyProfile(gsjj),
      industry: parseIndustry(concepts),
    };
    // 仅在有实际数据时缓存，避免缓存全 null 导致后续永远跳过
    if (result.roe !== null || result.profitMargin !== null || result.businessSummary || result.industry) {
      fundCache.set(cacheKey, { ts: Date.now(), data: result });
    }
    return result;
  } catch {
    return null;
  }
}
