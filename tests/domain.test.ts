import assert from "node:assert/strict";
import test from "node:test";
import { calculatePortfolio, isIsoDate, isStockCode, toCents, type Trade } from "../lib/domain";

function trade(values: Partial<Trade>): Trade {
  return {
    id: 1,
    symbol: "600519",
    name: "贵州茅台",
    side: "买入",
    priceCents: 10_000,
    quantity: 100,
    tradeDate: "2026-07-01",
    reason: "测试",
    maxLossCents: null,
    feeCents: 0,
    ...values,
  };
}

test("分批买卖按移动平均成本计算持仓和已实现盈亏", () => {
  const summary = calculatePortfolio([
    trade({ id: 1, priceCents: 10_000, quantity: 100 }),
    trade({ id: 2, priceCents: 12_000, quantity: 100, tradeDate: "2026-07-02" }),
    trade({ id: 3, side: "卖出", priceCents: 13_000, quantity: 150, tradeDate: "2026-07-03", feeCents: 100 }),
  ]);

  assert.equal(summary.positions.length, 1);
  assert.equal(summary.positions[0].quantity, 50);
  assert.equal(summary.positions[0].averageCostCents, 11_000);
  assert.equal(summary.realizedCents, 299_900);
  assert.equal(summary.winningSells, 1);
});

test("超出持仓数量的卖出不会制造负持仓", () => {
  const summary = calculatePortfolio([
    trade({ quantity: 20 }),
    trade({ id: 2, side: "卖出", quantity: 100, priceCents: 9_000, tradeDate: "2026-07-02" }),
  ]);
  assert.equal(summary.positions.length, 0);
  assert.equal(summary.realizedCents, -20_000);
});

test("金额和基础字段验证保持严格", () => {
  assert.equal(toCents("12.345"), 1235);
  assert.equal(toCents("bad"), 0);
  assert.equal(isStockCode("600519"), true);
  assert.equal(isStockCode("60051"), false);
  assert.equal(isIsoDate("2026-07-29"), true);
  assert.equal(isIsoDate("2026-02-30"), false);
  assert.equal(isIsoDate("29/07/2026"), false);
});
