/**
 * 券商对账单 CSV 导入（Broker statement import）
 *
 * 解决"全手工录入"的痛点：支持从券商导出的交割单 CSV 批量导入，自动识别
 * 列、归一化代码、校验后写入。解析与校验为纯函数，便于单元测试，也方便
 * 在导入前做预览。
 *
 * 对标：TraderVue / 投资账本 的"券商流水导入对账"。
 */
import { isIsoDate, isStockCode, isTradeSide, toCents, toTenThousandths } from "./domain";
import { canonicalStockName } from "./stocks";

export type PreparedTrade = {
  symbol: string;
  name: string;
  side: "买入" | "卖出";
  priceCents: number;
  priceMillis: number;
  priceTenThousandths: number;
  quantity: number;
  tradeDate: string;
  reason: string;
  maxLossCents: number | null;
  feeCents: number;
};

/** 与 /api/trades 同源的字段校验，保证单笔录入与批量导入规则一致。 */
export function prepareTradeInput(payload: Record<string, unknown>): { values?: PreparedTrade; error?: string } {
  const symbol = String(payload.symbol ?? "").trim();
  const name = canonicalStockName(symbol, String(payload.name ?? "").trim());
  const side = payload.side;
  const rawPrice = Number(payload.price);
  const maxLossNumber = Number(payload.maxLoss);
  const rawMaxLoss =
    payload.maxLoss === undefined || payload.maxLoss === null || payload.maxLoss === "" || maxLossNumber === 0
      ? null
      : maxLossNumber;
  const rawFee = payload.fee === undefined || payload.fee === null || payload.fee === "" ? 0 : Number(payload.fee);
  const priceTenThousandths = toTenThousandths(rawPrice);
  const priceMillis = Math.round(priceTenThousandths / 10);
  const priceCents = Math.round(priceTenThousandths / 100);
  const quantity = Number(payload.quantity);
  const tradeDate = payload.tradeDate;
  const reason = String(payload.reason ?? "").trim();
  const maxLossCents = rawMaxLoss === null ? null : toCents(rawMaxLoss);
  const feeCents = toCents(rawFee);

  if (!isStockCode(symbol) || !name || name.length > 30) return { error: "股票代码或名称不正确" };
  if (!isTradeSide(side)) return { error: "买卖方向不正确" };
  if (
    !Number.isFinite(rawPrice) ||
    priceTenThousandths <= 0 ||
    !Number.isSafeInteger(priceTenThousandths) ||
    !Number.isSafeInteger(quantity) ||
    quantity <= 0 ||
    !Number.isSafeInteger(priceTenThousandths * quantity)
  ) {
    return { error: "价格和数量必须是有效的正数，且交易金额不能超出安全范围" };
  }
  if (!isIsoDate(tradeDate)) return { error: "交易日期不正确" };
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
  if (tradeDate > today) return { error: "交易日期不能晚于今天" };
  if (!reason || reason.length > 200) return { error: "请选择或填写交易原因" };
  if (
    (rawMaxLoss !== null && (!Number.isFinite(rawMaxLoss) || maxLossCents === null || maxLossCents <= 0)) ||
    !Number.isFinite(rawFee) ||
    feeCents < 0 ||
    !Number.isSafeInteger(maxLossCents ?? 0) ||
    !Number.isSafeInteger(feeCents)
  ) {
    return { error: "最大亏损和费用必须是安全范围内的非负数" };
  }
  const riskPerShareTenThousandths =
    maxLossCents === null ? null : Math.round(maxLossCents * 100 / quantity);
  if (
    side === "买入" &&
    riskPerShareTenThousandths !== null &&
    riskPerShareTenThousandths >= priceTenThousandths
  ) {
    return { error: "最大亏损必须小于本次买入金额" };
  }
  return {
    values: {
      symbol,
      name,
      side,
      priceCents,
      priceMillis,
      priceTenThousandths,
      quantity,
      tradeDate,
      reason,
      maxLossCents,
      feeCents,
    },
  };
}

export type ParsedImportRow = {
  line: number;
  symbol: string;
  name: string;
  side: "买入" | "卖出";
  price: number;
  quantity: number;
  tradeDate: string;
  fee: number;
  reason: string;
};

type ColumnRole = "date" | "code" | "name" | "side" | "price" | "quantity" | "amount" | "fee";

function detectRole(header: string): ColumnRole | null {
  const text = header.trim().toLowerCase();
  if (/(日期|成交日期|交易日期|委托日期)/.test(text)) return "date";
  if (/(代码|证券代码|股票代码)/.test(text)) return "code";
  if (/(名称|证券名称|股票名称)/.test(text)) return "name";
  if (/(方向|买卖|操作|业务|标志)/.test(text)) return "side";
  if (/(价格|成交价|单价)/.test(text)) return "price";
  if (/(数量|股数|成交数量)/.test(text)) return "quantity";
  if (/(金额|成交金额|总额)/.test(text)) return "amount";
  if (/(费用|手续费|佣金|印花)/.test(text)) return "fee";
  return null;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (inQuotes) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields.map((field) => field.trim());
}

function normalizeSymbol(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, "");
  return digits.slice(-6);
}

function parseSide(raw: string): "买入" | "卖出" | null {
  const text = raw.trim().toLowerCase();
  if (/(买|buy|^b$)/.test(text)) return "买入";
  if (/(卖|sell|^s$)/.test(text)) return "卖出";
  return null;
}

function parseNumber(raw: string): number {
  const cleaned = raw.replace(/[¥￥,\s]/g, "");
  return Number(cleaned);
}

/** 解析券商 CSV，返回每行的归一化候选记录（未做业务校验）。 */
export function parseBrokerCsv(
  text: string,
  mappingOverride: Partial<Record<ColumnRole, string>> = {},
): ParsedImportRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  const roleToIndex = new Map<ColumnRole, number>();
  headers.forEach((header, index) => {
    const role = detectRole(header);
    if (role && !roleToIndex.has(role)) roleToIndex.set(role, index);
  });
  for (const [role, column] of Object.entries(mappingOverride)) {
    const index = headers.findIndex((header) => header.trim() === column);
    if (index >= 0) roleToIndex.set(role as ColumnRole, index);
  }

  const get = (fields: string[], role: ColumnRole): string => {
    const index = roleToIndex.get(role);
    return index === undefined ? "" : fields[index] ?? "";
  };

  const rows: ParsedImportRow[] = [];
  for (let lineNumber = 2; lineNumber <= lines.length; lineNumber += 1) {
    const fields = parseCsvLine(lines[lineNumber - 1]);
    const side = parseSide(get(fields, "side"));
    if (!side) continue;
    const symbol = normalizeSymbol(get(fields, "code"));
    const name = get(fields, "name");
    const price = parseNumber(get(fields, "price"));
    const quantity = parseNumber(get(fields, "quantity"));
    let tradeDate = get(fields, "date");
    if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(tradeDate)) {
      const parts = tradeDate.split("/");
      tradeDate = `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
    }
    const fee = parseNumber(get(fields, "fee"));
    rows.push({
      line: lineNumber,
      symbol,
      name,
      side,
      price,
      quantity,
      tradeDate,
      fee,
      reason: "券商导入",
    });
  }
  return rows;
}
