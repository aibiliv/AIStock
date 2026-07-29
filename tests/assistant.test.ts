import assert from "node:assert/strict";
import test from "node:test";
import { buildFallbackAnswer, type AssistantContext } from "../lib/assistant";

const context: AssistantContext = {
  stock: { code: "600519", name: "贵州茅台", industry: "白酒", instrumentType: "stock" },
  quote: {
    price: 1500,
    changePercent: 1.2,
    ma20: 1480,
    support: 1400,
    resistance: 1600,
    volatility: 1.8,
    marketTime: "2026-07-29T15:00:00+08:00",
  },
  financials: {
    revenueGrowth: 8,
    profitGrowth: 10,
    debtRatio: 15,
    pe: 22,
    pb: 7,
    roe: 30,
  },
  summary: "价格在20日均线上方，但仍需核验最新公告。",
  risks: ["近期波动可能放大"],
  missingInformation: ["最新公告"],
  source: { name: "腾讯证券", fetchedAt: "2026-07-29T15:01:00+08:00" },
  position: { quantity: 100, averageCost: 1450, returnPercent: 3.45 },
};

test("持仓问题会结合用户成本回答", () => {
  const answer = buildFallbackAnswer("结合我的持仓成本怎么看？", context);
  assert.match(answer, /1450\.000/);
  assert.match(answer, /\+3\.45%/);
});

test("风险问题会引用观察线和数据缺口", () => {
  const answer = buildFallbackAnswer("主要风险是什么？", context);
  assert.match(answer, /1400\.000/);
  assert.match(answer, /最新公告/);
});
