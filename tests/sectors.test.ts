import assert from "node:assert/strict";
import test from "node:test";
import { parseSectorKline, rankSectorMoves, validateSectorDate, type SectorMove } from "../lib/sectors";

function move(name: string, changePercent: number, amount: number): SectorMove {
  return {
    code: `BK${name}`,
    name,
    date: "2026-07-29",
    close: 100,
    changePercent,
    amount,
    amplitude: 0,
    turnover: 0,
  };
}

test("解析东方财富行业日线字段", () => {
  const result = parseSectorKline(
    { code: "BK0427", name: "公用事业" },
    "2026-07-29,100,102,103,99,12345,456000000,4.00,2.00,2.00,1.50",
  );

  assert.deepEqual(result, {
    code: "BK0427",
    name: "公用事业",
    date: "2026-07-29",
    close: 102,
    changePercent: 2,
    amount: 456000000,
    amplitude: 4,
    turnover: 1.5,
  });
});

test("异动榜按涨跌幅绝对值排序并保留涨跌方向", () => {
  const result = rankSectorMoves([
    move("电子", 1.2, 900),
    move("煤炭", -3.1, 300),
    move("银行", 2.4, 400),
    move("通信", -2.4, 800),
    move("汽车", 0.8, 700),
    move("传媒", 4.2, 200),
  ]);

  assert.deepEqual(result.map((item) => item.name), ["传媒", "煤炭", "通信", "银行", "电子"]);
  assert.equal(result[1].changePercent, -3.1);
});

test("板块日期拒绝无效日期和未来日期", () => {
  assert.equal(validateSectorDate("2026-02-30"), "日期格式不正确");
  assert.equal(validateSectorDate("2999-01-01"), "不能查询未来日期");
});
