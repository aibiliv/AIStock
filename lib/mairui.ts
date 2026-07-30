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

function parseRealtime(row: Record<string, unknown>): MairuiRealtime {
  const price = pick(row, ["p", "price", "zxj", "last", "now", "current", "trade", "zkj"]);
  const previousClose = pick(row, ["yc", "preClose", "prevClose", "zcj", "yclose", "previousClose"]);
  // 注意：响应里的 zf 是「振幅」不是涨跌幅；涨跌幅百分比字段是 pc
  let changePercent = pick(row, ["pc", "zdf", "changePercent", "pct", "pchange", "change"]);
  // 只有现价和昨收时自行计算涨跌幅
  if (changePercent === null && price !== null && previousClose && previousClose !== 0) {
    changePercent = ((price - previousClose) / previousClose) * 100;
  }
  const pe = pick(row, ["pe", "peRatio", "市盈率"]);
  const pb = pick(row, ["pb_ratio", "pb", "pbRatio", "市净率"]);
  const name =
    typeof row.mc === "string" ? row.mc
    : typeof row.name === "string" ? row.name
    : null;
  return { price, previousClose, changePercent, pe, pb, name };
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
