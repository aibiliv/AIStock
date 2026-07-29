import { isIsoDate } from "./domain";

export type SectorMove = {
  code: string;
  name: string;
  date: string;
  close: number;
  changePercent: number;
  amount: number;
  amplitude: number;
  turnover: number;
};

export type SectorHeatmap = {
  date: string;
  sectors: SectorMove[];
  sampleSize: number;
  source: {
    name: string;
    url: string;
    fetchedAt: string;
  };
};

type IndustryBoard = {
  code: string;
  name: string;
};

type KlineResponse = {
  data?: {
    klines?: string[];
  };
};

const INDUSTRY_BOARDS: IndustryBoard[] = [
  { code: "BK0433", name: "农林牧渔" },
  { code: "BK1206", name: "基础化工" },
  { code: "BK0479", name: "钢铁" },
  { code: "BK0478", name: "有色金属" },
  { code: "BK1201", name: "电子" },
  { code: "BK1211", name: "汽车" },
  { code: "BK0456", name: "家用电器" },
  { code: "BK0438", name: "食品饮料" },
  { code: "BK0436", name: "纺织服饰" },
  { code: "BK1212", name: "轻工制造" },
  { code: "BK1216", name: "医药生物" },
  { code: "BK0427", name: "公用事业" },
  { code: "BK1210", name: "交通运输" },
  { code: "BK1202", name: "房地产" },
  { code: "BK1213", name: "商贸零售" },
  { code: "BK1214", name: "社会服务" },
  { code: "BK1283", name: "银行" },
  { code: "BK1203", name: "非银金融" },
  { code: "BK1217", name: "综合" },
  { code: "BK1208", name: "建筑材料" },
  { code: "BK1209", name: "建筑装饰" },
  { code: "BK1200", name: "电力设备" },
  { code: "BK1205", name: "机械设备" },
  { code: "BK1204", name: "国防军工" },
  { code: "BK1207", name: "计算机" },
  { code: "BK0486", name: "传媒" },
  { code: "BK1215", name: "通信" },
  { code: "BK0437", name: "煤炭" },
  { code: "BK0464", name: "石油石化" },
  { code: "BK0728", name: "环保" },
  { code: "BK1035", name: "美容护理" },
];

const SOURCE_URL = "https://quote.eastmoney.com/center/boardlist.html#industry_board";

function shanghaiDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
}

export function validateSectorDate(value: string) {
  if (!isIsoDate(value)) return "日期格式不正确";
  if (value > shanghaiDate()) return "不能查询未来日期";
  if (value < "2018-01-01") return "暂时只支持查询2018年以后的交易日";
  return null;
}

export function parseSectorKline(board: IndustryBoard, line: string): SectorMove | null {
  const fields = line.split(",");
  const close = Number(fields[2]);
  const changePercent = Number(fields[8]);
  const amount = Number(fields[6]);
  if (!isIsoDate(fields[0]) || !Number.isFinite(close) || !Number.isFinite(changePercent)) return null;
  return {
    code: board.code,
    name: board.name,
    date: fields[0],
    close,
    changePercent,
    amount: Number.isFinite(amount) ? amount : 0,
    amplitude: Number.isFinite(Number(fields[7])) ? Number(fields[7]) : 0,
    turnover: Number.isFinite(Number(fields[10])) ? Number(fields[10]) : 0,
  };
}

export function rankSectorMoves(moves: SectorMove[], limit = 5) {
  return [...moves]
    .sort((left, right) =>
      Math.abs(right.changePercent) - Math.abs(left.changePercent) ||
      right.amount - left.amount ||
      left.name.localeCompare(right.name, "zh-CN")
    )
    .slice(0, limit);
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      referer: "https://quote.eastmoney.com/",
      "user-agent": "Mozilla/5.0 StockReviewAssistant/1.0",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`板块数据源返回 ${response.status}`);
  return response.json() as Promise<T>;
}

async function loadSectorMove(board: IndustryBoard, date: string) {
  const compactDate = date.replace(/-/g, "");
  const params = new URLSearchParams({
    secid: `90.${board.code}`,
    fields1: "f1,f2,f3,f4,f5,f6",
    fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
    klt: "101",
    fqt: "1",
    beg: compactDate,
    end: compactDate,
  });
  try {
    const payload = await fetchJson<KlineResponse>(
      `https://push2his.eastmoney.com/api/qt/stock/kline/get?${params}`,
    );
    const line = payload.data?.klines?.find((item) => item.startsWith(date));
    return line ? parseSectorKline(board, line) : null;
  } catch {
    return null;
  }
}

async function loadMoves(boards: IndustryBoard[], date: string) {
  const moves: SectorMove[] = [];
  for (let index = 0; index < boards.length; index += 6) {
    const batch = await Promise.all(
      boards.slice(index, index + 6).map((board) => loadSectorMove(board, date)),
    );
    moves.push(...batch.filter((move): move is SectorMove => move !== null));
  }
  return moves;
}

export async function getSectorHeatmap(date: string): Promise<SectorHeatmap> {
  const validationError = validateSectorDate(date);
  if (validationError) throw new Error(validationError);

  const moves = await loadMoves(INDUSTRY_BOARDS, date);
  if (moves.length < 5) {
    throw new Error("该日期没有完整的行业行情，可能是非交易日或数据源暂不可用");
  }

  return {
    date,
    sectors: rankSectorMoves(moves),
    sampleSize: moves.length,
    source: {
      name: "东方财富行业板块公开行情",
      url: SOURCE_URL,
      fetchedAt: new Date().toISOString(),
    },
  };
}
