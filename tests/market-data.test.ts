import assert from "node:assert/strict";
import test from "node:test";
import { mock } from "node:test";
import { getKlines, getProfile } from "../lib/market-data";

// 根据 URL 返回不同响应的 fetch mock，用于隔离外部行情源。
function makeRouter(routes: Record<string, (url: string) => unknown>) {
  return mock.fn(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    for (const key of Object.keys(routes)) {
      if (url.includes(key)) {
        const body = routes[key](url);
        if (body instanceof Error) throw body;
        return { ok: true, status: 200, json: async () => body } as Response;
      }
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  });
}

function emKlinesBody(n = 25) {
  return { data: { klines: Array.from({ length: n }, (_, i) => `2024-01-${String(i + 1).padStart(2, "0")},10,11,12,9,1000`) } };
}

test.beforeEach(() => {
  mock.restoreAll();
});

test("getKlines 优先东方财富（Yahoo 已移除，链仅东财+腾讯两级）", async () => {
  const fetchMock = makeRouter({
    "push2his.eastmoney.com": () => emKlinesBody(),
    "web.ifzq.gtimg.cn": () => new Error("腾讯挂了"),
  });
  mock.method(globalThis, "fetch", fetchMock as unknown as typeof fetch);

  const result = await getKlines("600519");
  assert.equal(result.sourceName, "东方财富历史K线");
  assert.ok(result.rows.length >= 20);
});

test("getKlines 东财+腾讯都失败直接抛错（无 Yahoo 第三级兜底）", async () => {
  const fetchMock = makeRouter({
    "push2his.eastmoney.com": () => new Error("东财挂了"),
    "web.ifzq.gtimg.cn": () => new Error("腾讯挂了"),
  });
  mock.method(globalThis, "fetch", fetchMock as unknown as typeof fetch);

  await assert.rejects(() => getKlines("600519"));
});

test("getProfile 东财填充名称/PE/PB，无麦蕊 token 时 roe/profitMargin 仍由财务主指标兜底", async () => {
  const fetchMock = makeRouter({
    "push2.eastmoney.com": () => ({ data: { f58: "测试股份", f116: "1234567890", f162: "1850", f167: "210" } }),
    "emweb.securities.eastmoney.com": () => ({ MainBusiness: [{ MAINOP_TYPE_NAME: "行业", MAINOP_BUSINESS: "半导体" }] }),
    "datacenter.eastmoney.com": () => ({
      data: { result: { data: [{ SECURITY_CODE: "600519", GROSS_PROFIT_RATIO: 91.5, NETPROFIT_RATIO: 50.2, ROE: 25.3, OPERATE_CASH_FLOW: 123456789, INDUSTRY_NAME: "白酒" }] } },
    }),
    "api.mairuiapi.com": () => new Error("不应命中麦蕊（未配置 token）"),
  });
  mock.method(globalThis, "fetch", fetchMock as unknown as typeof fetch);

  const profile = await getProfile("600519");
  assert.equal(profile.name, "测试股份");
  assert.equal(profile.pe, 18.5); // 1850 / 100
  assert.equal(profile.pb, 2.1); // 210 / 100
  assert.equal(profile.industry, "半导体");
  // 财务主指标兜底（无 token 也能填）
  assert.equal(profile.roe, 0.253, "ROE 25.3% 应归一为 0.253");
  assert.equal(profile.profitMargin, 0.502, "净利率 50.2% 应归一为 0.502");
  assert.equal(profile.grossMargin, 0.915, "毛利率 91.5% 应归一为 0.915");
  assert.equal(profile.operatingCashflow, 123456789);
  assert.equal(profile.sector, "白酒");
});

test("getProfile 配置麦蕊 token 时 roe/profitMargin 优先用麦蕊", async () => {
  process.env.MAIRUI_TOKEN = "test-token";
  const fetchMock = makeRouter({
    "push2.eastmoney.com": () => ({ data: { f58: "测试股份", f116: "1234567890", f162: "1850", f167: "210" } }),
    "emweb.securities.eastmoney.com": () => ({ MainBusiness: [] }),
    "datacenter.eastmoney.com": () => ({
      data: { result: { data: [{ SECURITY_CODE: "600519", GROSS_PROFIT_RATIO: 91.5, NETPROFIT_RATIO: 50.2, ROE: 25.3, OPERATE_CASH_FLOW: 123456789, INDUSTRY_NAME: "白酒" }] } },
    }),
    "api.mairuiapi.com": (url) => {
      if (url.includes("/hscp/cwzb/")) return [{ jzsy: 30, xsjl: 55 }]; // roe=0.30, 净利率=0.55
      if (url.includes("/hscp/gsjj/")) return { desc: "麦蕊简介" };
      if (url.includes("/hszg/zg/")) return [{ name: "申万行业-白酒制造" }];
      return {};
    },
  });
  mock.method(globalThis, "fetch", fetchMock as unknown as typeof fetch);

  const profile = await getProfile("600519");
  // 麦蕊优先覆盖 roe/profitMargin
  assert.equal(profile.roe, 0.30, "应优先使用麦蕊 roe");
  assert.equal(profile.profitMargin, 0.55, "应优先使用麦蕊 profitMargin");
  // 其余仍由东财主指标兜底
  assert.equal(profile.grossMargin, 0.915);
  assert.equal(profile.sector, "白酒");
  delete process.env.MAIRUI_TOKEN;
});

test("getProfile 财务主指标接口失败时三个字段退化为 null（不影响主流程）", async () => {
  const fetchMock = makeRouter({
    "push2.eastmoney.com": () => ({ data: { f58: "测试股份", f116: "1234567890", f162: "1850", f167: "210" } }),
    "emweb.securities.eastmoney.com": () => ({ MainBusiness: [{ MAINOP_TYPE_NAME: "行业", MAINOP_BUSINESS: "半导体" }] }),
    "datacenter.eastmoney.com": () => new Error("东方财富财务主指标接口挂了"),
    "api.mairuiapi.com": () => new Error("不应命中麦蕊（未配置 token）"),
  });
  mock.method(globalThis, "fetch", fetchMock as unknown as typeof fetch);

  const profile = await getProfile("600519");
  assert.equal(profile.name, "测试股份");
  assert.equal(profile.grossMargin, null);
  assert.equal(profile.operatingCashflow, null);
  assert.equal(profile.sector, null);
});
