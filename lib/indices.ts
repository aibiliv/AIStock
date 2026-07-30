// 主要大盘指数实时行情（东方财富 push2 批量接口）。
// 注意：指数代码与个股代码冲突（如 000001 既是平安银行也是上证指数），
// 因此这里用东方财富 secid 精确区分，不走 lib/stocks 的 eastmoneySecid 规则。
export type IndexQuote = {
  code: string;
  name: string;
  price: number;
  changePercent: number;
  change: number;
};

export type IndicesData = {
  indices: IndexQuote[];
  source: { name: string; url: string; fetchedAt: string };
};

// secid 规则：上交所=1.x，深交所=0.x；北证50 为特殊 secid 0.899050。
export const MAJOR_INDICES: Array<{ code: string; secid: string; name: string }> = [
  { code: "000001", secid: "1.000001", name: "上证指数" },
  { code: "399001", secid: "0.399001", name: "深证成指" },
  { code: "399006", secid: "0.399006", name: "创业板指" },
  { code: "000300", secid: "1.000300", name: "沪深300" },
  { code: "000688", secid: "1.000688", name: "科创50" },
  { code: "000016", secid: "1.000016", name: "上证50" },
  { code: "899050", secid: "0.899050", name: "北证50" },
];

export async function getIndexQuotes(): Promise<IndicesData> {
  const secids = MAJOR_INDICES.map((item) => item.secid).join(",");
  const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${secids}&fields=f12,f13,f14,f2,f3,f4&invt=2&_=${Date.now()}`;
  const response = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 StockReviewAssistant/1.0" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new Error(`数据源返回 ${response.status}`);
  }
  const payload = await response.json() as { data?: { diff?: Array<Record<string, number | string>> } };
  const diff = payload.data?.diff ?? [];
  const bySecid = new Map(diff.map((item) => [`${item.f13}.${item.f12}`, item]));
  const indices: IndexQuote[] = [];
  for (const meta of MAJOR_INDICES) {
    const item = bySecid.get(meta.secid);
    if (!item) continue;
    const price = Number(item.f2);
    if (!Number.isFinite(price) || price <= 0) continue;
    const changePercent = Number(item.f3);
    const change = Number(item.f4);
    indices.push({
      code: meta.code,
      name: typeof item.f14 === "string" && item.f14 ? item.f14 : meta.name,
      price,
      changePercent: Number.isFinite(changePercent) ? changePercent : 0,
      change: Number.isFinite(change) ? change : 0,
    });
  }
  return {
    indices,
    source: {
      name: "东方财富公开行情",
      url: "https://quote.eastmoney.com/center/index.html",
      fetchedAt: new Date().toISOString(),
    },
  };
}
