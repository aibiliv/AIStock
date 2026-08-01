import assert from "node:assert/strict";
import test from "node:test";
import { mock } from "node:test";
import { getKlines, getProfile } from "../lib/market-data";

// 根据 URL 返回不同响应的 fetch mock，用于隔离外部行情源。
function makeRouter(routes: Record<string, () => unknown>) {
  return mock.fn(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    for (const key of Object.keys(routes)) {
      if (url.includes(key)) {
        const body = routes[key]();
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

test("getProfile 东财填充名称/PE/PB，无麦蕊时 roe 退化为 null", async () => {
  const fetchMock = makeRouter({
    "push2.eastmoney.com": () => ({ data: { f58: "测试股份", f116: "1234567890", f162: "1850", f167: "210" } }),
    "emweb.securities.eastmoney.com": () => ({ MainBusiness: [{ MAINOP_TYPE_NAME: "行业", MAINOP_BUSINESS: "半导体" }] }),
    "api.mairui.club": () => new Error("不应命中麦蕊（未配置 token）"),
  });
  mock.method(globalThis, "fetch", fetchMock as unknown as typeof fetch);

  const profile = await getProfile("600519");
  assert.equal(profile.name, "测试股份");
  assert.equal(profile.pe, 18.5); // 1850 / 100
  assert.equal(profile.pb, 2.1); // 210 / 100
  assert.equal(profile.industry, "半导体");
  assert.equal(profile.roe, null, "无麦蕊 token 时 roe 应为 null（Yahoo 已移除）");
});
