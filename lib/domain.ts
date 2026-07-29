export type Trade = {
  id: number;
  symbol: string;
  name: string;
  side: "买入" | "卖出";
  priceCents: number;
  quantity: number;
  tradeDate: string;
  reason: string;
  maxLossCents: number | null;
  feeCents: number;
  createdAt?: string;
};

export type Position = {
  symbol: string;
  name: string;
  quantity: number;
  costCents: number;
  averageCostCents: number;
};

export type PortfolioSummary = {
  positions: Position[];
  realizedCents: number;
  winningSells: number;
  losingSells: number;
};

export type TradeCycle = {
  symbol: string;
  name: string;
  trades: Trade[];
  startTradeId: number;
  endTradeId: number | null;
  startDate: string;
  endDate: string | null;
  realizedCents: number;
};

function orderedTrades(trades: Trade[]) {
  return [...trades].sort((a, b) => {
    const dateOrder = a.tradeDate.localeCompare(b.tradeDate);
    return dateOrder || a.id - b.id;
  });
}

export function calculatePortfolio(trades: Trade[]): PortfolioSummary {
  const positions = new Map<string, Position>();
  let realizedCents = 0;
  let winningSells = 0;
  let losingSells = 0;

  for (const trade of orderedTrades(trades)) {
    const current = positions.get(trade.symbol) ?? {
      symbol: trade.symbol,
      name: trade.name,
      quantity: 0,
      costCents: 0,
      averageCostCents: 0,
    };

    if (trade.side === "买入") {
      current.quantity += trade.quantity;
      current.costCents += trade.priceCents * trade.quantity + trade.feeCents;
      current.averageCostCents = Math.round(current.costCents / current.quantity);
      positions.set(trade.symbol, current);
      continue;
    }

    const soldQuantity = Math.min(trade.quantity, current.quantity);
    if (soldQuantity <= 0) {
      continue;
    }

    const saleProfit =
      trade.priceCents * soldQuantity -
      current.averageCostCents * soldQuantity -
      trade.feeCents;
    realizedCents += saleProfit;
    if (saleProfit > 0) winningSells += 1;
    if (saleProfit < 0) losingSells += 1;

    current.quantity -= soldQuantity;
    current.costCents = Math.max(0, current.costCents - current.averageCostCents * soldQuantity);
    current.averageCostCents = current.quantity > 0
      ? Math.round(current.costCents / current.quantity)
      : 0;
    positions.set(trade.symbol, current);
  }

  return {
    positions: [...positions.values()].filter((position) => position.quantity > 0),
    realizedCents,
    winningSells,
    losingSells,
  };
}

export function buildTradeCycles(trades: Trade[]): TradeCycle[] {
  const cycles: TradeCycle[] = [];
  const open = new Map<string, { quantity: number; trades: Trade[] }>();

  for (const trade of orderedTrades(trades)) {
    if (trade.side === "买入") {
      const current = open.get(trade.symbol) ?? { quantity: 0, trades: [] };
      current.quantity += trade.quantity;
      current.trades.push(trade);
      open.set(trade.symbol, current);
      continue;
    }

    const current = open.get(trade.symbol);
    if (!current || current.quantity <= 0) continue;
    current.trades.push(trade);
    current.quantity = Math.max(0, current.quantity - trade.quantity);
    if (current.quantity > 0) continue;

    cycles.push({
      symbol: trade.symbol,
      name: trade.name,
      trades: current.trades,
      startTradeId: current.trades[0].id,
      endTradeId: trade.id,
      startDate: current.trades[0].tradeDate,
      endDate: trade.tradeDate,
      realizedCents: calculatePortfolio(current.trades).realizedCents,
    });
    open.delete(trade.symbol);
  }

  for (const current of open.values()) {
    const first = current.trades[0];
    cycles.push({
      symbol: first.symbol,
      name: first.name,
      trades: current.trades,
      startTradeId: first.id,
      endTradeId: null,
      startDate: first.tradeDate,
      endDate: null,
      realizedCents: calculatePortfolio(current.trades).realizedCents,
    });
  }

  return cycles.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.startTradeId - b.startTradeId);
}

export function localIsoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function toCents(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

export function isStockCode(value: string) {
  return /^\d{6}$/.test(value.trim());
}

export function isTradeSide(value: unknown): value is "买入" | "卖出" {
  return value === "买入" || value === "卖出";
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
