import { calculatePortfolio, type Trade } from "./domain";

export type PriceHistory = Record<string, Array<{ date: string; close: number }>>;

export type PortfolioInsights = {
  configured: boolean;
  completePrices: boolean;
  initialCapitalCents: number | null;
  cashCents: number | null;
  marketValueCents: number;
  totalAssetsCents: number | null;
  totalPositionPercent: number | null;
  unrealizedCents: number;
  realizedCents: number;
  totalProfitCents: number | null;
  totalProfitPercent: number | null;
  positions: Array<{
    symbol: string;
    name: string;
    marketValueCents: number;
    unrealizedCents: number;
    returnPercent: number;
    allocationPercent: number | null;
  }>;
  history: Array<{
    date: string;
    totalAssetsCents: number;
    positionPercent: number;
  }>;
};

function tradeValueCents(trade: Trade) {
  const priceTenThousandths =
    trade.priceTenThousandths ?? (trade.priceMillis ?? trade.priceCents * 10) * 10;
  return Math.round(priceTenThousandths * trade.quantity / 100);
}

export function calculatePortfolioInsights(
  trades: Trade[],
  currentPrices: Record<string, number>,
  histories: PriceHistory,
  initialCapitalCents: number | null,
): PortfolioInsights {
  const portfolio = calculatePortfolio(trades);
  const completePrices = portfolio.positions.every((position) => Number.isFinite(currentPrices[position.symbol]));
  const positions: PortfolioInsights["positions"] = portfolio.positions.map((position) => {
    const currentPrice = currentPrices[position.symbol] ?? position.averageCostTenThousandths / 10_000;
    const marketValueCents = Math.round(currentPrice * 100 * position.quantity);
    const costCents = Math.round(position.costTenThousandths / 100);
    return {
      symbol: position.symbol,
      name: position.name,
      marketValueCents,
      unrealizedCents: marketValueCents - costCents,
      returnPercent: costCents ? ((marketValueCents / costCents) - 1) * 100 : 0,
      allocationPercent: null,
    };
  });
  const marketValueCents = positions.reduce((sum, position) => sum + position.marketValueCents, 0);
  const unrealizedCents = positions.reduce((sum, position) => sum + position.unrealizedCents, 0);
  const cashCents = initialCapitalCents === null
    ? null
    : trades.reduce((cash, trade) => (
        trade.side === "买入"
          ? cash - tradeValueCents(trade) - trade.feeCents
          : cash + tradeValueCents(trade) - trade.feeCents
      ), initialCapitalCents);
  const totalAssetsCents = cashCents === null ? null : cashCents + marketValueCents;

  for (const position of positions) {
    position.allocationPercent = totalAssetsCents && totalAssetsCents > 0
      ? position.marketValueCents / totalAssetsCents * 100
      : marketValueCents > 0
        ? position.marketValueCents / marketValueCents * 100
        : null;
  }

  const history = initialCapitalCents === null
    ? []
    : buildPortfolioHistory(trades, histories, initialCapitalCents);
  const totalProfitCents = initialCapitalCents === null || totalAssetsCents === null
    ? null
    : totalAssetsCents - initialCapitalCents;

  return {
    configured: initialCapitalCents !== null,
    completePrices,
    initialCapitalCents,
    cashCents,
    marketValueCents,
    totalAssetsCents,
    totalPositionPercent: totalAssetsCents && totalAssetsCents > 0 ? marketValueCents / totalAssetsCents * 100 : null,
    unrealizedCents,
    realizedCents: portfolio.realizedCents,
    totalProfitCents,
    totalProfitPercent: totalProfitCents === null || !initialCapitalCents
      ? null
      : totalProfitCents / initialCapitalCents * 100,
    positions,
    history,
  };
}

function buildPortfolioHistory(trades: Trade[], histories: PriceHistory, initialCapitalCents: number) {
  if (!trades.length) return [];
  const firstTradeDate = [...trades].sort((left, right) => left.tradeDate.localeCompare(right.tradeDate))[0].tradeDate;
  const dates = [...new Set(Object.values(histories).flatMap((rows) => rows.map((row) => row.date)))]
    .filter((date) => date >= firstTradeDate)
    .sort()
    .slice(-180);
  const orderedTrades = [...trades].sort((left, right) =>
    left.tradeDate.localeCompare(right.tradeDate) || left.id - right.id
  );

  let cashCents = initialCapitalCents;
  let tradeIndex = 0;
  const quantities = new Map<string, number>();
  const latestPrices = new Map<string, number>();
  const historyRows = Object.fromEntries(
    Object.entries(histories).map(([symbol, rows]) => [symbol, new Map(rows.map((row) => [row.date, row.close]))]),
  );
  const points: Array<{ date: string; totalAssetsCents: number; positionPercent: number }> = [];

  for (const date of dates) {
    while (tradeIndex < orderedTrades.length && orderedTrades[tradeIndex].tradeDate <= date) {
      const trade = orderedTrades[tradeIndex];
      const direction = trade.side === "买入" ? 1 : -1;
      quantities.set(trade.symbol, Math.max(0, (quantities.get(trade.symbol) ?? 0) + direction * trade.quantity));
      cashCents += trade.side === "买入"
        ? -tradeValueCents(trade) - trade.feeCents
        : tradeValueCents(trade) - trade.feeCents;
      tradeIndex += 1;
    }
    for (const [symbol, rows] of Object.entries(historyRows)) {
      const close = rows.get(date);
      if (close !== undefined) latestPrices.set(symbol, close);
    }
    const marketValueCents = [...quantities.entries()].reduce(
      (sum, [symbol, quantity]) => sum + Math.round((latestPrices.get(symbol) ?? 0) * 100 * quantity),
      0,
    );
    const totalAssetsCents = cashCents + marketValueCents;
    points.push({
      date,
      totalAssetsCents,
      positionPercent: totalAssetsCents > 0 ? marketValueCents / totalAssetsCents * 100 : 0,
    });
  }
  return points;
}
