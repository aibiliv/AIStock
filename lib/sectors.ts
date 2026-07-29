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

type BoardRow = {
  f12?: string;
  f14?: string;
};

type BoardListResponse = {
  data?: {
    total?: number;
    diff?: BoardRow[] | Record<string, BoardRow>;
  };
};

type KlineResponse = {
  data?: {
    klines?: string[];
  };
};

const INDUSTRY_NAMES = new Set([
  "农林牧渔", "基础化工", "钢铁", "有色金属", "电子", "汽车", "家用电器", "食品饮料",
  "纺织服饰", "轻工制造", "医药生物", "公用事业", "交通运输", "房地产", "商贸零售",
  "社会服务", "银行", "非银金融", "综合", "建筑材料", "建筑装饰", "电力设备", "机械设备",
  "国防军工", "计算机", "传媒", "通信", "煤炭", "石油石化", "环保", "美容护理",
]);

const SOURCE_URL = "https://quote.eastmoney.com/center/boardlist.html#industry_board";
let boardCache: { expiresAt: number; boards: IndustryBoard[] } | null = null;

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

function normalizeBoards(value: BoardRow[] | Record<string, BoardRow> | undefined) {
  if (!value) return [];
  return Array.isArray(value) ? value : Object.values(value);
}

async function loadIndustryBoards() {
  if (boardCache && boardCache.expiresAt > Date.now()) return boardCache.boards;

  const boards: IndustryBoard[] = [];
  for (let page = 1; page <= 5; page += 1) {
    const params = new URLSearchParams({
      pn: String(page),
      pz: "100",
      po: "0",
      np: "1",
      fltt: "2",
      invt: "2",
      fid: "f12",
      fs: "m:90+t:2+f:!50",
      fields: "f12,f14",
    });
    const payload = await fetchJson<BoardListResponse>(
      `https://push2.eastmoney.com/api/qt/clist/get?${params}`,
    );
    const rows = normalizeBoards(payload.data?.diff);
    for (const row of rows) {
      const code = row.f12?.trim() ?? "";
      const name = row.f14?.trim() ?? "";
      if (/^BK\d+$/.test(code) && INDUSTRY_NAMES.has(name)) boards.push({ code, name });
    }
    if (rows.length < 100 || page * 100 >= (payload.data?.total ?? 0)) break;
  }

  const unique = [...new Map(boards.map((board) => [board.name, board])).values()];
  if (unique.length < 20) throw new Error("行业板块列表暂时不完整，请稍后重试");
  boardCache = { boards: unique, expiresAt: Date.now() + 12 * 60 * 60 * 1000 };
  return unique;
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

  const boards = await loadIndustryBoards();
  const moves = await loadMoves(boards, date);
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
