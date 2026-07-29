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

export function calculatePortfolio(trades: Trade[]): PortfolioSummary {
  const positions = new Map<string, Position>();
  let realizedCents = 0;
  let winningSells = 0;
  let losingSells = 0;

  const ordered = [...trades].sort((a, b) => {
    const dateOrder = a.tradeDate.localeCompare(b.tradeDate);
    return dateOrder || a.id - b.id;
  });

  for (const trade of ordered) {
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
