"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ArrowsLeftRight,
  CheckCircle,
  GearSix,
  House,
  MagnifyingGlass,
  Plus,
  ShieldCheck,
  SignOut,
  Star,
  type Icon,
} from "@phosphor-icons/react";
import {
  aggregateMarketHistory,
  buildTradeCycles,
  calculatePortfolio,
  localIsoDate,
  type MarketPeriod,
  type Trade,
  type TradeCycle,
} from "../lib/domain";
import type { SectorHeatmap as SectorHeatmapData } from "../lib/sectors";
import { calculatePortfolioInsights, type PortfolioInsights } from "../lib/portfolio-insights";

type View = "home" | "watchlist" | "trades" | "settings";
type TradeMode = "buy" | "sell";

type WatchItem = {
  id: number;
  symbol: string;
  name: string;
  note: string;
  conditionText: string;
  status: "研究中" | "等待条件" | "已买入" | "暂停";
  lastReviewedAt: string | null;
  updatedAt: string;
  createdAt: string;
};

type AlertRule = {
  id: number;
  symbol: string;
  name: string;
  type: "止损" | "止盈一" | "止盈二";
  targetPriceCents: number;
  targetPriceMillis: number | null;
  enabled: boolean;
  acknowledgedAt: string | null;
};

type Review = {
  id: number;
  symbol: string;
  name: string;
  cycleEndTradeId: number | null;
  followedPlan: boolean;
  lesson: string;
  resultCents: number;
};

type Explanation = {
  summary: string;
  company: string[];
  risks: string[];
  themes: Array<{ name: string; confidence: string; reason: string }>;
  missingInformation: string[];
};

type FundProfile = {
  manager: string;
  trackingIndex: string;
  exchange: string;
  category: string;
  inceptionDate: string;
  sourceName: string;
  sourceUrl: string;
};

type Analysis = {
  historyWarning?: string;
  stock: {
    code: string;
    name: string;
    industry: string;
    instrumentType: "stock" | "etf";
    fund: FundProfile | null;
    marketSymbol: string;
    sector?: string | null;
    businessSummary?: string | null;
  };
  quote: {
    price: number;
    previousClose: number;
    changePercent: number;
    ma5: number;
    ma20: number;
    ma60: number;
    recentHigh: number;
    recentLow: number;
    support: number;
    resistance: number;
    volatility: number;
    target1: number;
    target2: number;
    marketTime: string | null;
  };
  financials: {
    revenueGrowth: number | null;
    profitGrowth: number | null;
    debtRatio: number | null;
    marketCap: number | null;
    pe: number | null;
    pb: number | null;
    roe: number | null;
    grossMargin: number | null;
    profitMargin: number | null;
    operatingCashflow: number | null;
    series: Record<string, Array<{ date: string; value: number }>>;
  };
  history: Array<{
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    ma5: number | null;
    ma20: number | null;
    ma60: number | null;
  }>;
  volumeHighlight: {
    date: string;
    close: number;
    volume: number;
  } | null;
  source: { name: string; url: string; fetchedAt: string };
  mode: "deepseek" | "automatic";
  explanation: Explanation;
};

type Position = ReturnType<typeof calculatePortfolio>["positions"][number];

type AssistantMessage = {
  role: "user" | "assistant";
  content: string;
};

type Status = {
  deepseekConfigured: boolean;
  aiProvider?: string;
  dataSource: string;
  reminderMode: string;
};

type User = {
  displayName: string;
  email: string;
};

const navItems: Array<{ id: View; label: string; icon: Icon }> = [
  { id: "home", label: "首页", icon: House },
  { id: "watchlist", label: "关注", icon: Star },
  { id: "trades", label: "交易记录", icon: ArrowsLeftRight },
  { id: "settings", label: "设置", icon: GearSix },
];

const buyReasons = ["看好公司业绩", "看好行业题材", "价格回调", "突破买入", "朋友或网络推荐", "担心错过", "冲动买入", "其他"];
const sellReasons = ["达到止盈目标", "触发止损", "买入逻辑失效", "害怕利润回吐", "临时需要资金", "看到其他股票", "不知道为什么卖", "其他"];

function money(cents: number) {
  return `¥${(cents / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function price(value: number) {
  const digits = Math.abs(value) < 10 ? 3 : 2;
  return `¥${value.toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function millisPrice(millis: number) {
  return price(millis / 1000);
}

function tenThousandthsPrice(value: number) {
  return `¥${(value / 10_000).toLocaleString("zh-CN", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  })}`;
}

function alertPrice(alert: AlertRule) {
  const value = millisPrice(alert.targetPriceMillis ?? alert.targetPriceCents * 10);
  return alert.targetPriceMillis === null || alert.targetPriceMillis === undefined ? `约${value}` : value;
}

function tradePrice(trade: Trade) {
  if (trade.priceTenThousandths !== null && trade.priceTenThousandths !== undefined) {
    return tenThousandthsPrice(trade.priceTenThousandths);
  }
  const value = millisPrice(trade.priceMillis ?? trade.priceCents * 10);
  return trade.priceMillis === null || trade.priceMillis === undefined ? `约${value}` : value;
}

function compactAmount(value: number) {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}亿`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万`;
  return value.toLocaleString("zh-CN");
}

function compactVolume(value: number) {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(2)}亿`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万`;
  return value.toLocaleString("zh-CN");
}

function latestWeekday() {
  const date = new Date();
  while (date.getDay() === 0 || date.getDay() === 6) date.setDate(date.getDate() - 1);
  return localIsoDate(date);
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new Error("网络连接中断，请稍后重试");
  }
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "请求失败");
  return payload;
}

export function Dashboard({ user, signOutUrl }: { user: User; signOutUrl: string }) {
  const [view, setView] = useState<View>("home");
  const [query, setQuery] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [quotes, setQuotes] = useState<Record<string, Analysis>>({});
  const [trades, setTrades] = useState<Trade[]>([]);
  const [watchlist, setWatchlist] = useState<WatchItem[]>([]);
  const [alerts, setAlerts] = useState<AlertRule[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [initialCapitalCents, setInitialCapitalCents] = useState<number | null>(null);
  const [tradeMode, setTradeMode] = useState<TradeMode | null>(null);
  const [reviewCycleEndTradeId, setReviewCycleEndTradeId] = useState<number | null>(null);
  const [settingsSection, setSettingsSection] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const notified = useRef(new Set<number>());
  const pendingQuotes = useRef(new Set<string>());

  function navigate(nextView: View) {
    setView(nextView);
    if (nextView === "home") setAnalysis(null);
  }

  const portfolio = useMemo(() => calculatePortfolio(trades), [trades]);
  const portfolioInsights = useMemo(() => calculatePortfolioInsights(
    trades,
    Object.fromEntries(Object.entries(quotes).map(([symbol, item]) => [symbol, item.quote.price])),
    Object.fromEntries(Object.entries(quotes).map(([symbol, item]) => [symbol, item.history])),
    initialCapitalCents,
  ), [initialCapitalCents, quotes, trades]);
  const tradeCycles = useMemo(() => buildTradeCycles(trades), [trades]);
  const closedCycles = tradeCycles.filter((cycle) => cycle.endTradeId !== null);
  const reviewedCycleIds = useMemo(() => {
    const ids = new Set(reviews.flatMap((review) => review.cycleEndTradeId ? [review.cycleEndTradeId] : []));
    for (const review of reviews.filter((item) => item.cycleEndTradeId === null)) {
      const legacyCycle = [...closedCycles]
        .reverse()
        .find((cycle) => cycle.symbol === review.symbol && cycle.endTradeId && !ids.has(cycle.endTradeId));
      if (legacyCycle?.endTradeId) ids.add(legacyCycle.endTradeId);
    }
    return ids;
  }, [closedCycles, reviews]);
  const pendingReviews = closedCycles.filter((cycle) =>
    cycle.endTradeId !== null && !reviewedCycleIds.has(cycle.endTradeId)
  );

  const flash = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }, []);

  const loadData = useCallback(async () => {
    try {
      const [tradeData, watchData, alertData, reviewData, statusData, accountData] = await Promise.all([
        jsonRequest<{ trades: Trade[] }>("/api/trades"),
        jsonRequest<{ items: WatchItem[] }>("/api/watchlist"),
        jsonRequest<{ alerts: AlertRule[] }>("/api/alerts"),
        jsonRequest<{ reviews: Review[] }>("/api/reviews"),
        jsonRequest<Status>("/api/status"),
        jsonRequest<{ initialCapitalCents: number | null }>("/api/account"),
      ]);
      setTrades(tradeData.trades);
      setWatchlist(watchData.items);
      setAlerts(alertData.alerts);
      setReviews(reviewData.reviews);
      setStatus(statusData);
      setInitialCapitalCents(accountData.initialCapitalCents);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "个人数据暂时无法读取");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const fetchAnalysis = useCallback(async (stockQuery: string, showResult = true) => {
    if (showResult) {
      setAnalyzing(true);
      setError("");
      setAnalysis(null);
    }
    try {
      const result = await jsonRequest<Analysis>("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: stockQuery, saveHistory: showResult, explain: showResult }),
      });
      setQuotes((current) => ({ ...current, [result.stock.code]: result }));
      if (showResult) {
        setAnalysis(result);
        setQuery(result.stock.code);
        setView("home");
        if (result.historyWarning) flash(result.historyWarning);
      }
      return result;
    } catch (analyzeError) {
      const message = analyzeError instanceof Error ? analyzeError.message : "股票分析失败";
      if (showResult) {
        setError(message);
        flash(message);
      }
      return null;
    } finally {
      if (showResult) setAnalyzing(false);
    }
  }, [flash]);

  const refreshQuote = useCallback((symbol: string) => {
    if (pendingQuotes.current.has(symbol)) return;
    pendingQuotes.current.add(symbol);
    void fetchAnalysis(symbol, false).finally(() => pendingQuotes.current.delete(symbol));
  }, [fetchAnalysis]);

  useEffect(() => {
    const symbols = new Set([
      ...portfolio.positions.map((position) => position.symbol),
      ...alerts.filter((alert) => alert.enabled).map((alert) => alert.symbol),
    ]);
    const timer = window.setTimeout(() => {
      for (const symbol of symbols) {
        if (!quotes[symbol]) refreshQuote(symbol);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [alerts, portfolio.positions, quotes, refreshQuote]);

  const checkAlerts = useCallback(() => {
    for (const alert of alerts) {
      if (!alert.enabled || alert.acknowledgedAt || notified.current.has(alert.id)) continue;
      const current = quotes[alert.symbol]?.quote.price;
      if (!current) continue;
      const target = (alert.targetPriceMillis ?? alert.targetPriceCents * 10) / 1000;
      const triggered = alert.type === "止损" ? current <= target : current >= target;
      if (!triggered) continue;
      notified.current.add(alert.id);
      const message = `${alert.name}已触发${alert.type}提醒：当前${price(current)}，目标${price(target)}`;
      flash(message);
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("我的复盘助手", { body: message });
      }
    }
  }, [alerts, flash, quotes]);

  useEffect(() => {
    const firstCheck = window.setTimeout(checkAlerts, 0);
    const timer = window.setInterval(() => {
      for (const symbol of new Set(alerts.filter((item) => item.enabled).map((item) => item.symbol))) {
        refreshQuote(symbol);
      }
    }, 300_000);
    return () => {
      window.clearTimeout(firstCheck);
      window.clearInterval(timer);
    };
  }, [alerts, checkAlerts, refreshQuote]);

  async function analyzeStock(event?: FormEvent) {
    event?.preventDefault();
    if (!query.trim()) {
      flash("请输入股票代码或名称");
      return;
    }
    await fetchAnalysis(query);
  }

  async function addWatch(stock = analysis?.stock) {
    if (!stock) {
      flash("请先分析一只股票");
      return;
    }
    try {
      await jsonRequest("/api/watchlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol: stock.code, name: stock.name, note: "等待自己的买入条件" }),
      });
      await loadData();
      flash(`${stock.name}已加入关注`);
    } catch (saveError) {
      flash(saveError instanceof Error ? saveError.message : "加入关注失败");
    }
  }

  async function removeWatch(symbol: string) {
    try {
      await jsonRequest(`/api/watchlist?symbol=${symbol}`, { method: "DELETE" });
      await loadData();
      flash("已移出关注");
    } catch (removeError) {
      flash(removeError instanceof Error ? removeError.message : "移出关注失败");
    }
  }

  async function saveTrade(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const side = tradeMode === "sell" ? "卖出" : "买入";
    const payload = {
      symbol: String(data.get("symbol")),
      name: String(data.get("name")),
      side,
      price: Number(data.get("price")),
      quantity: Number(data.get("quantity")),
      tradeDate: String(data.get("tradeDate")),
      reason: String(data.get("reason")),
      maxLoss: Number(data.get("maxLoss") || 0),
      fee: Number(data.get("fee") || 0),
    };

    try {
      const saved = await jsonRequest<{ trade: Trade }>("/api/trades", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      setTradeMode(null);
      await loadData();
      flash(`${payload.name}的${side}记录已保存`);
      if (side === "卖出") {
        const closedCycle = buildTradeCycles([...trades, saved.trade]).find(
          (cycle) => cycle.endTradeId === saved.trade.id
        );
        if (closedCycle?.endTradeId) setReviewCycleEndTradeId(closedCycle.endTradeId);
      }
    } catch (saveError) {
      flash(saveError instanceof Error ? saveError.message : "交易记录保存失败");
    }
  }

  async function updateAlert(id: number, action = "acknowledge") {
    try {
      await jsonRequest("/api/alerts", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      await loadData();
      flash(action === "disable" ? "提醒已停用" : "提醒已确认");
    } catch (updateError) {
      flash(updateError instanceof Error ? updateError.message : "提醒更新失败");
    }
  }

  async function requestNotifications() {
    if (!("Notification" in window)) {
      flash("当前浏览器不支持系统通知");
      return;
    }
    const permission = await Notification.requestPermission();
    flash(permission === "granted" ? "浏览器通知已开启" : "浏览器通知未开启");
    setSettingsSection("alerts");
  }

  async function saveInitialCapital(initialCapital: number) {
    const result = await jsonRequest<{ initialCapitalCents: number }>("/api/account", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initialCapital }),
    });
    setInitialCapitalCents(result.initialCapitalCents);
    flash("账户初始资金已保存");
  }

  const analyzedPosition = portfolio.positions.find((position) => position.symbol === analysis?.stock.code);
  const currentTradeStock = tradeMode === "sell"
    ? analyzedPosition ?? portfolio.positions[0] ?? null
    : analysis?.stock ?? null;
  const reviewCycle = reviewCycleEndTradeId === null
    ? null
    : closedCycles.find((cycle) => cycle.endTradeId === reviewCycleEndTradeId) ?? null;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => navigate("home")}>
          <span className="brand-mark">股</span>
          <span><strong>我的复盘助手</strong><small>看懂 · 记录 · 复盘</small></span>
        </button>
        <nav aria-label="主导航">
          {navItems.map((item) => {
            const NavIcon = item.icon;
            return (
              <button key={item.id} className={view === item.id ? "nav-item active" : "nav-item"} onClick={() => navigate(item.id)}>
                <span><NavIcon size={19} weight={view === item.id ? "fill" : "regular"} /></span>{item.label}
              </button>
            );
          })}
        </nav>
        <div className="safety-note">
          <span>给新手的提醒</span>
          <p>AI只负责解释信息，不替你决定买卖。重要止损请同时在券商App设置。</p>
        </div>
        <div className="source-status">
          <i />
          <span><b>{status?.deepseekConfigured ? (status.aiProvider === "openai" ? "OpenAI分析" : "AI分析") : "自动解释模式"}</b><small>{status?.dataSource ?? "正在检查数据源"}</small></span>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div><span className="mobile-brand">我的复盘助手</span><h1>{navItems.find((item) => item.id === view)?.label}</h1></div>
          <div className="top-actions">
            <span className="privacy-pill"><ShieldCheck size={15} weight="fill" />私有个人空间</span>
            <a className="account-button" href={signOutUrl} title={`当前账号：${user.email}`}>
              <span>{user.displayName.slice(0, 1).toUpperCase()}</span>
              <b>{user.displayName}</b>
              <SignOut size={15} aria-label="退出" />
            </a>
            <button className="primary-button" onClick={() => setTradeMode("buy")}><Plus size={16} weight="bold" />记录买入</button>
          </div>
        </header>

        {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError("")}>关闭</button></div>}
        {loading ? <div className="loading-state">正在读取你的个人记录…</div> : (
          <>
            {view === "home" && (
              <Home
                query={query}
                setQuery={setQuery}
                analysis={analysis}
                analyzing={analyzing}
                portfolio={portfolio}
                portfolioInsights={portfolioInsights}
                quotes={quotes}
                alerts={alerts}
                pendingReviews={pendingReviews}
                trades={trades}
                reviews={reviews}
                watched={analysis ? watchlist.some((item) => item.symbol === analysis.stock.code) : false}
                onAnalyze={analyzeStock}
                onBuy={() => setTradeMode("buy")}
                onSell={() => setTradeMode("sell")}
                onWatch={() => void addWatch()}
                onNavigate={navigate}
                onReview={setReviewCycleEndTradeId}
                onAlertPlan={() => { setSettingsSection("alerts"); setView("settings"); }}
                onAcknowledge={(id) => void updateAlert(id)}
                onCapitalSettings={() => { setSettingsSection("account"); setView("settings"); }}
              />
            )}
            {view === "watchlist" && (
              <Watchlist
                items={watchlist}
                quotes={quotes}
                onSearch={() => navigate("home")}
                onAnalyze={(symbol) => void fetchAnalysis(symbol)}
                onRemove={(symbol) => void removeWatch(symbol)}
                onSaved={() => void loadData()}
              />
            )}
            {view === "trades" && (
              <Trades
                trades={trades}
                reviews={reviews}
                onBuy={() => setTradeMode("buy")}
                onSell={() => setTradeMode("sell")}
                onReview={setReviewCycleEndTradeId}
              />
            )}
            {view === "settings" && (
              <Settings
                status={status}
                initialCapitalCents={initialCapitalCents}
                alerts={alerts}
                section={settingsSection}
                onSection={setSettingsSection}
                onDisable={(id) => void updateAlert(id, "disable")}
                onNotifications={() => void requestNotifications()}
                onSaveCapital={saveInitialCapital}
              />
            )}
          </>
        )}
      </main>

      <nav className="mobile-nav" aria-label="移动端导航">
        {navItems.map((item) => {
          const NavIcon = item.icon;
          return (
            <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => navigate(item.id)}>
              <NavIcon size={20} weight={view === item.id ? "fill" : "regular"} />{item.label}
            </button>
          );
        })}
      </nav>

      {tradeMode && (
        <TradeModal
          mode={tradeMode}
          stock={currentTradeStock}
          positions={portfolio.positions}
          onClose={() => setTradeMode(null)}
          onSubmit={saveTrade}
        />
      )}
      {reviewCycle && (
        <ReviewModal
          cycle={reviewCycle}
          onClose={() => setReviewCycleEndTradeId(null)}
          onSaved={async () => { setReviewCycleEndTradeId(null); await loadData(); flash("复盘已保存"); }}
        />
      )}
      {toast && <div className="toast" role="status" aria-live="polite"><CheckCircle size={19} weight="fill" />{toast}</div>}
    </div>
  );
}

function Home({
  query, setQuery, analysis, analyzing, portfolio, portfolioInsights, quotes, alerts, pendingReviews,
  trades, reviews, watched, onAnalyze, onBuy, onSell, onWatch, onNavigate,
  onReview, onAlertPlan, onAcknowledge, onCapitalSettings,
}: {
  query: string;
  setQuery: (value: string) => void;
  analysis: Analysis | null;
  analyzing: boolean;
  portfolio: ReturnType<typeof calculatePortfolio>;
  portfolioInsights: PortfolioInsights;
  quotes: Record<string, Analysis>;
  alerts: AlertRule[];
  pendingReviews: TradeCycle[];
  trades: Trade[];
  reviews: Review[];
  watched: boolean;
  onAnalyze: (event?: FormEvent) => Promise<void>;
  onBuy: () => void;
  onSell: () => void;
  onWatch: () => void;
  onNavigate: (view: View) => void;
  onReview: (cycleEndTradeId: number) => void;
  onAlertPlan: () => void;
  onAcknowledge: (id: number) => void;
  onCapitalSettings: () => void;
}) {
  const activeAlerts = alerts.filter((alert) => alert.enabled && !alert.acknowledgedAt);
  const completedCycles = buildTradeCycles(trades).filter((cycle) => cycle.endTradeId !== null);
  const winningCycles = completedCycles.filter((cycle) => cycle.realizedCents > 0).length;
  const winRate = completedCycles.length ? Math.round((winningCycles / completedCycles.length) * 100) : 0;
  const planRate = reviews.length ? Math.round((reviews.filter((review) => review.followedPlan).length / reviews.length) * 100) : 0;

  return (
    <div className="page-content">
      <section className={analysis ? "search-hero compact" : "search-hero"}>
        <span className="eyebrow">A股新手也能看懂</span>
        <h2>{analysis ? "继续查" : "输入代码，先把它看懂。"}</h2>
        {!analysis && <p>公开数据提供事实，AI或自动规则负责解释，你负责最后的决定。</p>}
        <form className="stock-search" onSubmit={onAnalyze}>
          <span className="search-icon"><MagnifyingGlass size={21} /></span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例如 600519、贵州茅台" aria-label="股票代码或名称" />
          <button type="submit" disabled={analyzing}>{analyzing ? "正在获取数据…" : "开始分析"}</button>
        </form>
        <div className="search-meta"><span>无需股票数据账号</span><i /><span>结果标明数据时间</span><i /><span>不提供买卖建议</span></div>
      </section>

      {analysis ? (
        <AnalysisView
          analysis={analysis}
          position={portfolio.positions.find((position) => position.symbol === analysis.stock.code) ?? null}
          portfolioInsights={portfolioInsights}
          watched={watched}
          canSell={portfolio.positions.some((position) => position.symbol === analysis.stock.code)}
          onWatch={onWatch}
          onBuy={onBuy}
          onSell={onSell}
        />
      ) : (
        <>
          {!trades.length && <BeginnerStart onBuy={onBuy} />}
          <PortfolioOverview insights={portfolioInsights} onConfigure={onCapitalSettings} />
          <SectorHeatmap />
          <section className="quick-title"><div><span className="eyebrow">今天只处理重要的事</span><h3>我的持仓</h3></div><button onClick={() => onNavigate("trades")}>查看交易记录 →</button></section>
          {portfolio.positions.length ? (
            <div className="holding-grid">
              {portfolio.positions.map((position) => {
                const quote = quotes[position.symbol]?.quote.price;
                const insight = portfolioInsights.positions.find((item) => item.symbol === position.symbol);
                const profitCents = insight?.unrealizedCents ?? 0;
                const rate = quote ? insight?.returnPercent ?? null : null;
                const stop = activeAlerts.find((item) => item.symbol === position.symbol && item.type === "止损");
                return (
                  <article className="holding-card" key={position.symbol}>
                    <div className="holding-top">
                      <span className="stock-avatar">{position.name.slice(0, 1)}</span>
                      <div><h4>{position.name}<small>{position.symbol}</small></h4><p>{position.quantity}股 · 成本{position.legacyPrecision ? "约" : ""}{tenThousandthsPrice(position.averageCostTenThousandths)}</p></div>
                      <strong className={(rate ?? 0) >= 0 ? "up" : "down"}>{rate === null ? "行情更新中" : `${rate >= 0 ? "+" : ""}${rate.toFixed(2)}%`}</strong>
                    </div>
                    <div className="risk-line"><span>{insight?.allocationPercent !== null && insight?.allocationPercent !== undefined ? `${portfolioInsights.configured ? "账户仓位" : "持仓内部占比"} ${insight.allocationPercent.toFixed(1)}%` : "按当前参考价计算"}</span><b>{quote ? money(profitCents) : "暂无"}</b></div>
                    <div className={`holding-status ${stop ? "amber" : ""}`}><i />{stop ? `止损提醒 ${alertPrice(stop)}` : "尚未设置止损提醒"}</div>
                  </article>
                );
              })}
            </div>
          ) : <div className="empty-state">还没有持仓。先查一只股票，或记录你的第一笔买入。</div>}

          <div className="summary-strip home-summary">
            <div><span>已实现盈亏</span><strong className={portfolio.realizedCents >= 0 ? "up" : "down"}>{money(portfolio.realizedCents)}</strong></div>
            <div><span>完整交易胜率</span><strong>{completedCycles.length ? `${winRate}%` : "暂无"}</strong></div>
            <div><span>按计划复盘</span><strong>{reviews.length ? `${planRate}%` : "暂无"}</strong></div>
            <div><span>最近改进规则</span><strong className="summary-lesson">{reviews[0]?.lesson ?? "暂无"}</strong></div>
          </div>

          {!!trades.length && (
            <BehaviorCoach
              trades={trades}
              completedCycles={completedCycles}
              reviews={reviews}
              pendingReviews={pendingReviews}
              onReview={onReview}
            />
          )}

          <div className="home-grid">
            <section className="panel reminder-panel">
              <PanelHeader title="价格提醒" subtitle="页面打开期间每5分钟检查" />
              {activeAlerts.slice(0, 3).map((alert) => (
                <div className="reminder" key={alert.id}>
                  <span className={`reminder-icon ${alert.type === "止损" ? "red" : "amber"}`}>!</span>
                  <div><b>{alert.name} · {alert.type}</b><p>目标价 {alertPrice(alert)} · 免费行情可能延迟</p></div>
                  <div className="reminder-actions"><button onClick={onAlertPlan}>查看计划</button><button onClick={() => onAcknowledge(alert.id)}>我知道了</button></div>
                </div>
              ))}
              {!activeAlerts.length && <div className="empty-inline">暂无提醒。记录买入并填写最大亏损后会自动生成。</div>}
            </section>
            <section className="panel review-panel">
              <PanelHeader title="待复盘" subtitle="卖出后只回答三个问题" />
              {pendingReviews.slice(0, 3).map((cycle) => {
                return (
                  <div className="review-item" key={cycle.endTradeId}>
                    <span className="stock-avatar pale">{cycle.name.slice(0, 1)}</span>
                    <div><b>{cycle.name}</b><p>{cycle.startDate} 至 {cycle.endDate}，已经清仓</p></div>
                    <button onClick={() => onReview(cycle.endTradeId!)}>开始复盘 →</button>
                  </div>
                );
              })}
              {!pendingReviews.length && <div className="empty-inline">目前没有待复盘交易。</div>}
              <div className="simple-rule"><span>复盘不考试</span><p>只看：为什么买、为什么卖、有没有按计划。</p></div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function PortfolioOverview({ insights, onConfigure }: { insights: PortfolioInsights; onConfigure: () => void }) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const points = insights.history;
  const width = 900;
  const height = 210;
  const assets = points.map((point) => point.totalAssetsCents);
  const minAssets = Math.min(...assets, 0);
  const maxAssets = Math.max(...assets, 1);
  const assetRange = Math.max(maxAssets - minAssets, 1);
  const x = (index: number) => points.length <= 1 ? 0 : index / (points.length - 1) * width;
  const assetY = (value: number) => 12 + (maxAssets - value) / assetRange * 150;
  const positionY = (value: number) => 12 + (100 - Math.max(0, Math.min(100, value))) / 100 * 150;
  const assetLine = points.map((point, index) => `${x(index).toFixed(1)},${assetY(point.totalAssetsCents).toFixed(1)}`).join(" ");
  const positionLine = points.map((point, index) => `${x(index).toFixed(1)},${positionY(point.positionPercent).toFixed(1)}`).join(" ");
  const selectedPoint = selectedIndex === null ? null : points[selectedIndex];
  const selectedMarketValue = selectedPoint
    ? Math.round(selectedPoint.totalAssetsCents * selectedPoint.positionPercent / 100)
    : 0;
  const selectedCash = selectedPoint ? selectedPoint.totalAssetsCents - selectedMarketValue : 0;
  const previousAssets = selectedIndex !== null && selectedIndex > 0 ? points[selectedIndex - 1].totalAssetsCents : null;
  const selectedDailyProfit = selectedPoint && previousAssets !== null
    ? selectedPoint.totalAssetsCents - previousAssets
    : null;
  const tooltipX = selectedIndex === null ? 0 : x(selectedIndex) > width / 2 ? x(selectedIndex) - 242 : x(selectedIndex) + 12;

  function selectAtPointer(event: ReactPointerEvent<SVGSVGElement>) {
    const matrix = event.currentTarget.getScreenCTM();
    if (!matrix || !points.length) return;
    const point = event.currentTarget.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const pointer = point.matrixTransform(matrix.inverse());
    if (pointer.x < 0 || pointer.x > width || pointer.y < 0 || pointer.y > 170) {
      setSelectedIndex(null);
      return;
    }
    const index = points.length <= 1
      ? 0
      : Math.round(Math.max(0, Math.min(width, pointer.x)) / width * (points.length - 1));
    setSelectedIndex(index);
  }

  function navigateChart(event: ReactKeyboardEvent<SVGSVGElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Escape") return setSelectedIndex(null);
    if (event.key === "Home") return setSelectedIndex(0);
    if (event.key === "End") return setSelectedIndex(points.length - 1);
    const current = selectedIndex ?? points.length - 1;
    setSelectedIndex(Math.max(0, Math.min(points.length - 1, current + (event.key === "ArrowLeft" ? -1 : 1))));
  }

  return (
    <section className="panel portfolio-overview">
      <div className="portfolio-overview-head">
        <div><span className="eyebrow">账户全景</span><h3>我的仓位与盈亏</h3></div>
        {!insights.configured && <button className="primary-button" onClick={onConfigure}>设置账户初始资金</button>}
      </div>
      <div className="portfolio-metrics">
        <div><span>总资产</span><strong>{insights.totalAssetsCents === null ? "待设置" : money(insights.totalAssetsCents)}</strong><small>现金 + 当前持仓市值</small></div>
        <div><span>总仓位</span><strong>{insights.totalPositionPercent === null ? "待设置" : `${insights.totalPositionPercent.toFixed(1)}%`}</strong><small>持仓市值 ÷ 总资产</small></div>
        <div><span>持仓市值</span><strong>{money(insights.marketValueCents)}</strong><small>{insights.completePrices ? "按当前参考价" : "部分行情仍在更新"}</small></div>
        <div><span>可用现金</span><strong>{insights.cashCents === null ? "待设置" : money(insights.cashCents)}</strong><small>按初始资金和交易流水估算</small></div>
        <div><span>持仓浮盈亏</span><strong className={insights.unrealizedCents >= 0 ? "up" : "down"}>{money(insights.unrealizedCents)}</strong><small>当前市值 - 持仓成本</small></div>
        <div><span>账户总盈亏</span><strong className={(insights.totalProfitCents ?? 0) >= 0 ? "up" : "down"}>{insights.totalProfitCents === null ? "待设置" : money(insights.totalProfitCents)}</strong><small>{insights.totalProfitPercent === null ? "需要资金基准" : `${insights.totalProfitPercent >= 0 ? "+" : ""}${insights.totalProfitPercent.toFixed(2)}%`}</small></div>
      </div>
      {points.length >= 2 ? (
        <div className="portfolio-chart-wrap">
          <div className="portfolio-chart-legend"><span className="asset">总资产</span><span className="position">总仓位</span></div>
          <p className="chart-interaction-hint">移动鼠标或点按查看每天的资产、现金与仓位，键盘可使用左右方向键。</p>
          <svg
            className="portfolio-chart"
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            tabIndex={0}
            aria-label="账户总资产和总仓位历史走势图。移动鼠标、点按或使用左右方向键查看每天明细。"
            onPointerMove={selectAtPointer}
            onPointerDown={selectAtPointer}
            onPointerLeave={(event) => { if (event.pointerType !== "touch") setSelectedIndex(null); }}
            onKeyDown={navigateChart}
          >
            <line x1="0" y1="162" x2={width} y2="162" className="portfolio-axis" />
            <polyline points={assetLine} className="portfolio-asset-line" />
            <polyline points={positionLine} className="portfolio-position-line" />
            {selectedPoint && selectedIndex !== null && (
              <g className="portfolio-selection" pointerEvents="none">
                <line x1={x(selectedIndex)} x2={x(selectedIndex)} y1="5" y2="162" className="chart-crosshair" />
                <line x1="0" x2={width} y1={assetY(selectedPoint.totalAssetsCents)} y2={assetY(selectedPoint.totalAssetsCents)} className="chart-crosshair chart-crosshair-horizontal" />
                <circle cx={x(selectedIndex)} cy={assetY(selectedPoint.totalAssetsCents)} r="4" className="portfolio-asset-dot" />
                <circle cx={x(selectedIndex)} cy={positionY(selectedPoint.positionPercent)} r="4" className="portfolio-position-dot" />
                <g transform={`translate(${tooltipX}, 8)`} className="chart-tooltip portfolio-tooltip">
                  <rect width="230" height="132" rx="9" />
                  <text x="12" y="19" className="chart-tooltip-date">{selectedPoint.date}</text>
                  <text x="12" y="40">总资产 <tspan x="218" textAnchor="end">{money(selectedPoint.totalAssetsCents)}</tspan></text>
                  <text x="12" y="59">总仓位 <tspan x="218" textAnchor="end">{selectedPoint.positionPercent.toFixed(1)}%</tspan></text>
                  <text x="12" y="78">持仓市值 <tspan x="218" textAnchor="end">{money(selectedMarketValue)}</tspan></text>
                  <text x="12" y="97">可用现金 <tspan x="218" textAnchor="end">{money(selectedCash)}</tspan></text>
                  <text x="12" y="116">当日资产变化 <tspan x="218" textAnchor="end" className={(selectedDailyProfit ?? 0) >= 0 ? "chart-tooltip-up" : "chart-tooltip-down"}>{selectedDailyProfit === null ? "首日" : `${selectedDailyProfit >= 0 ? "+" : ""}${money(selectedDailyProfit)}`}</tspan></text>
                </g>
              </g>
            )}
            <text x="0" y="190">{points[0].date}</text>
            <text x={width} y="190" textAnchor="end">{points.at(-1)?.date}</text>
          </svg>
        </div>
      ) : (
        <p className="portfolio-chart-empty">{insights.configured ? "持仓行情加载后生成资产与仓位走势。" : "设置初始资金后，系统会根据交易流水生成总资产和仓位走势。"}</p>
      )}
      <p className="portfolio-method">计算口径：初始资金减买入、加卖出并扣除费用，再叠加当前持仓市值。若有场外转入转出，请更新资金基准。</p>
    </section>
  );
}

function BeginnerStart({ onBuy }: { onBuy: () => void }) {
  const [showExample, setShowExample] = useState(false);

  return (
    <section className="panel beginner-start">
      <div className="beginner-copy">
        <span className="eyebrow">第一次使用，从这里开始</span>
        <h3>完成一轮真实记录，复盘才有价值。</h3>
        <p>不用一次学会所有指标。先按三个步骤走完一笔交易，软件会开始总结你的行为。</p>
      </div>
      <div className="beginner-steps" aria-label="新手三步上手">
        <div><b>1</b><span><strong>先查清楚</strong><small>输入股票，读公司、风险和缺失信息。</small></span></div>
        <div><b>2</b><span><strong>买前写计划</strong><small>记录买入理由和最多接受亏损。</small></span></div>
        <div><b>3</b><span><strong>清仓后复盘</strong><small>只回答为什么买、为什么卖、是否按计划。</small></span></div>
      </div>
      <div className="beginner-actions">
        <button className="primary-button" onClick={onBuy}><Plus size={16} weight="bold" />记录第一笔买入</button>
        <button className="text-button" onClick={() => setShowExample((value) => !value)}>
          {showExample ? "收起示例 ↑" : "先看一份完整示例 →"}
        </button>
      </div>
      {showExample && (
        <div className="review-example">
          <div><span>示例结果</span><strong className="down">−8.6%</strong></div>
          <dl>
            <div><dt>为什么买？</dt><dd>朋友推荐后担心错过，没有先核验风险。</dd></div>
            <div><dt>为什么卖？</dt><dd>跌破原定风险线后又拖了两天，亏损继续扩大。</dd></div>
            <div><dt>按计划了吗？</dt><dd>没有。知道退出条件，但没有当天执行。</dd></div>
            <div><dt>下次只改一件事</dt><dd>买入前写好退出条件；触发后当天执行，不向下移动。</dd></div>
          </dl>
          <p>示例只展示复盘方法，不代表任何真实股票或收益。</p>
        </div>
      )}
    </section>
  );
}

function BehaviorCoach({
  trades,
  completedCycles,
  reviews,
  pendingReviews,
  onReview,
}: {
  trades: Trade[];
  completedCycles: TradeCycle[];
  reviews: Review[];
  pendingReviews: TradeCycle[];
  onReview: (cycleEndTradeId: number) => void;
}) {
  const buyTrades = trades.filter((trade) => trade.side === "买入");
  const plannedBuys = buyTrades.filter((trade) => (trade.maxLossCents ?? 0) > 0);
  const reasonCounts = new Map<string, number>();
  for (const trade of buyTrades) {
    reasonCounts.set(trade.reason, (reasonCounts.get(trade.reason) ?? 0) + 1);
  }
  const topReason = [...reasonCounts.entries()].sort((a, b) => b[1] - a[1])[0];

  const lossReasonCounts = new Map<string, number>();
  for (const cycle of completedCycles.filter((item) => item.realizedCents < 0)) {
    for (const trade of cycle.trades.filter((item) => item.side === "买入")) {
      lossReasonCounts.set(trade.reason, (lossReasonCounts.get(trade.reason) ?? 0) + 1);
    }
  }
  const lossPattern = [...lossReasonCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const followedPlans = reviews.filter((review) => review.followedPlan).length;

  let advice = reviews[0]?.lesson ?? "继续记录，等完成一轮交易后再总结，不凭一笔输赢下结论。";
  if (plannedBuys.length < buyTrades.length) {
    advice = "下一次买入前，先写下最多接受亏损；没有退出条件，就先不下单。";
  } else if (pendingReviews.length) {
    advice = "完成最近一笔待复盘，只找一个最值得改的动作。";
  } else if (reviews.some((review) => !review.followedPlan)) {
    advice = reviews.find((review) => !review.followedPlan)?.lesson ?? "下一笔交易只检查一件事：是否按原计划执行。";
  }

  return (
    <section className="panel behavior-coach">
      <div className="coach-head">
        <div><span className="eyebrow">你的记录正在说什么</span><h3>行为复盘</h3></div>
        <p>样本少时只描述事实，不把偶然输赢当成规律。</p>
      </div>
      <div className="behavior-grid">
        <div><span>买入计划覆盖</span><strong>{plannedBuys.length}/{buyTrades.length}</strong><small>填写了最多接受亏损</small></div>
        <div><span>最常见买入原因</span><strong>{topReason?.[0] ?? "暂无"}</strong><small>{topReason ? `出现 ${topReason[1]} 次` : "继续记录后生成"}</small></div>
        <div><span>亏损交易共性</span><strong>{lossPattern?.[0] ?? "暂无样本"}</strong><small>{lossPattern ? `${lossPattern[1]} 次亏损周期涉及此原因` : "完成亏损交易后再判断"}</small></div>
        <div><span>按计划执行</span><strong>{reviews.length ? `${Math.round(followedPlans / reviews.length * 100)}%` : "暂无"}</strong><small>{reviews.length ? `${followedPlans}/${reviews.length} 次复盘` : "完成清仓复盘后生成"}</small></div>
      </div>
      <div className="weekly-advice">
        <span>本周只改这一件事</span>
        <p>{advice}</p>
        {!!pendingReviews.length && <button onClick={() => onReview(pendingReviews[0].endTradeId!)}>现在去复盘 →</button>}
      </div>
    </section>
  );
}

function SectorHeatmap() {
  const [date, setDate] = useState(latestWeekday);
  const [data, setData] = useState<SectorHeatmapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const load = useCallback(async (selectedDate: string) => {
    setLoading(true);
    setMessage("");
    try {
      const heatmap = await jsonRequest<SectorHeatmapData>(
        `/api/sector-heatmap?date=${encodeURIComponent(selectedDate)}&limit=10`,
      );
      setData(heatmap);
    } catch (loadError) {
      setData(null);
      setMessage(loadError instanceof Error ? loadError.message : "板块行情获取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(date), 0);
    return () => window.clearTimeout(timer);
  }, [date, load]);

  function submit(event: FormEvent) {
    event.preventDefault();
    void load(date);
  }

  return (
    <section className="panel sector-heatmap-card" aria-labelledby="sector-heatmap-title">
      <div className="sector-heatmap-head">
        <div>
          <span className="eyebrow">{data?.basis === "etf-proxy" ? "行业主题ETF代理 · 前10名" : "板块异动 · 前10名"}</span>
          <h3 id="sector-heatmap-title">板块异动热力图</h3>
          <p>以代表性行业ETF观察板块强弱，按涨跌幅绝对值排序。</p>
        </div>
        <form className="sector-date-form" onSubmit={submit}>
          <label htmlFor="sector-date">查看日期</label>
          <input
            id="sector-date"
            type="date"
            min="2018-01-01"
            max={localIsoDate()}
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
          <button type="submit" disabled={loading}>{loading ? "加载中…" : "查看异动"}</button>
        </form>
      </div>

      {loading && <div className="sector-heatmap-state" role="status">正在汇总行业板块行情…</div>}
      {!loading && message && (
        <div className="sector-heatmap-state error" role="alert">
          <b>暂时无法显示这一天的数据</b>
          <span>{message}</span>
        </div>
      )}
      {!loading && data && (
        <>
          <div className="sector-heatmap-grid">
            {data.sectors.map((sector, index) => {
              const direction = sector.changePercent > 0 ? "up-sector" : sector.changePercent < 0 ? "down-sector" : "flat-sector";
              return (
                <article className={`sector-tile ${direction} rank-${index + 1}`} key={sector.code}>
                  <div className="sector-tile-top">
                    <span>#{index + 1}</span>
                    <small>{sector.changePercent >= 0 ? "上涨异动" : "下跌异动"}</small>
                  </div>
                  <div>
                    <h4>{sector.name}</h4>
                    <strong>{sector.changePercent >= 0 ? "+" : ""}{sector.changePercent.toFixed(2)}%</strong>
                  </div>
                  <p>成交额 {compactAmount(sector.amount)}</p>
                </article>
              );
            })}
          </div>
          <div className="sector-heatmap-foot">
            <span>{data.date} · 覆盖 {data.sampleSize} 只代表性行业ETF</span>
            <a href={data.source.url} target="_blank" rel="noreferrer">数据来源：{data.source.name} ↗</a>
          </div>
        </>
      )}
    </section>
  );
}

function AnalysisView({ analysis, position, portfolioInsights, watched, canSell, onWatch, onBuy, onSell }: {
  analysis: Analysis;
  position: Position | null;
  portfolioInsights: PortfolioInsights;
  watched: boolean;
  canSell: boolean;
  onWatch: () => void;
  onBuy: () => void;
  onSell: () => void;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const { stock, quote, financials, explanation } = analysis;
  const isEtf = stock.instrumentType === "etf" && stock.fund;
  const companyLabels = isEtf
    ? ["基金产品", "跟踪指数", "基金管理人", "交易属性"]
    : ["是什么", "数据代码", "还要核验", "板块"];
  const quoteDate = quote.marketTime ? new Date(quote.marketTime).toLocaleString("zh-CN") : "数据源未提供";

  return (
    <div className="analysis-page">
      <section className="stock-summary panel">
        <div className="stock-identity">
          <span className="stock-avatar large">{stock.name.slice(0, 1)}</span>
          <div><span className="demo-label">{analysis.mode === "deepseek" ? "AI解释" : "自动解释"}</span><h2>{stock.name} <small>{stock.code}</small></h2><p>{stock.industry}{stock.sector ? ` · ${stock.sector}` : ""}</p></div>
        </div>
        <div className="price-block">
          <strong>{price(quote.price)}</strong>
          <span className={quote.changePercent >= 0 ? "up" : "down"}>{quote.changePercent >= 0 ? "+" : ""}{quote.changePercent.toFixed(2)}%</span>
          <small>行情时间 {quoteDate}</small>
        </div>
        <div className="summary-actions">
          <button className={watched ? "soft-button active" : "soft-button"} onClick={onWatch}>
            {watched ? <><CheckCircle size={15} weight="fill" />已关注</> : <><Star size={15} />加入关注</>}
          </button>
          <button className="primary-button" onClick={onBuy}>记录买入</button>
        </div>
      </section>

      <section className="ai-conclusion">
        <span className="ai-mark">{analysis.mode === "deepseek" ? "AI" : "算"}</span>
        <div><span>一句话看懂</span><h3>{explanation.summary}</h3><p>只基于页面所列公开数据整理，不构成投资建议。</p></div>
      </section>

      <EvidencePanel analysis={analysis} position={position} />
      <SmartAssistant key={stock.code} analysis={analysis} position={position} portfolioInsights={portfolioInsights} />

      <MarketChart analysis={analysis} />

      <div className="analysis-grid">
        <section className="panel analysis-card">
          <CardTitle number="01" title={isEtf ? "基金与指数" : "公司与行业"} source={isEtf ? "基金官方资料" : "通俗解释"} />
          <div className="plain-points">
            {explanation.company.map((item, index) => <p key={item}><b>{companyLabels[index] ?? "信息"}</b><span>{item}</span></p>)}
          </div>
          {!isEtf && stock.businessSummary && (
            <p className="company-brief">公司简介：{stock.businessSummary.length > 90 ? `${stock.businessSummary.slice(0, 90)}…` : stock.businessSummary}</p>
          )}
        </section>

        <section className="panel analysis-card">
          <CardTitle number="02" title={isEtf ? "基金资料" : "财务体检"} source={isEtf ? "基金官方资料" : "公开财务接口"} />
          {isEtf ? (
            <>
              <div className="fund-facts">
                <div><span>基金管理人</span><strong>{stock.fund!.manager}</strong></div>
                <div><span>标的指数</span><strong>{stock.fund!.trackingIndex}</strong></div>
                <div><span>产品类型</span><strong>{stock.fund!.category}</strong></div>
                <div><span>上市市场</span><strong>{stock.fund!.exchange}</strong></div>
              </div>
              <p className="source-warning">净值、折溢价、规模和跟踪误差尚未接入，页面不会用公司财务指标代替。</p>
              <a className="text-button fund-source-link" href={stock.fund!.sourceUrl} target="_blank" rel="noreferrer">查看{stock.fund!.sourceName}官方资料 ↗</a>
            </>
          ) : (
            <>
              <div className="metric-row">
                <Metric label="营收变化" value={financials.revenueGrowth} suffix="%" />
                <Metric label="利润变化" value={financials.profitGrowth} suffix="%" />
                <Metric label="负债率" value={financials.debtRatio} suffix="%" />
              </div>
              <div className="metric-row">
                <Metric label="总市值" value={financials.marketCap} marketCapValue />
                <Metric label="市盈率" value={financials.pe} suffix="" help="股价相对公司利润的倍数" />
                <Metric label="市净率" value={financials.pb} suffix="" help="股价相对净资产的倍数" />
              </div>
              <div className="metric-row">
                <Metric label="ROE" value={financials.roe} percentValue help="公司使用股东资金赚钱的能力" />
                <Metric label="毛利率" value={financials.grossMargin} percentValue />
                <Metric label="净利率" value={financials.profitMargin} percentValue />
              </div>
              <button className="text-button" onClick={() => setShowRaw((value) => !value)}>{showRaw ? "收起原始数字 ↑" : "展开查看原始数字 →"}</button>
              {showRaw && (
                <div className="raw-data">
                  {Object.entries(financials.series).map(([key, rows]) => (
                    <div key={key}><b>{key}</b>{rows.length ? rows.map((row) => <span key={row.date}>{row.date}: {row.value.toLocaleString("zh-CN")}</span>) : <span>暂无数据</span>}</div>
                  ))}
                  {!Object.keys(financials.series).length && <p>数据源暂未返回财务明细。</p>}
                </div>
              )}
            </>
          )}
        </section>

        <section className="panel analysis-card">
          <CardTitle number="03" title="价格位置" source="程序计算" />
          <div className="metric-row">
            <Metric label="20日均线" value={quote.ma20} moneyValue help="近20个交易日收盘价的平均值" />
            <Metric label="近60日高点" value={quote.recentHigh} moneyValue />
            <Metric label="平均日波动" value={quote.volatility} suffix="%" help="近期每天涨跌幅度的平均水平" />
          </div>
          <p className="card-note">价格位于20日均线{quote.price >= quote.ma20 ? "上方" : "下方"}。价格位置只能辅助制定计划，不能单独决定买卖。</p>
        </section>

        <section className="panel analysis-card">
          <CardTitle number="04" title={isEtf ? "指数与产品特征" : "题材信息"} source={isEtf ? "基金资料已核验" : "候选信息 · 需核验"} />
          <div className="theme-list">
            {explanation.themes.map((theme) => <div key={theme.name}><b>{theme.name}</b><span className="confidence high">{theme.confidence}</span><p>{theme.reason}</p></div>)}
          </div>
          <p className="source-warning">{isEtf ? "指数成份不等于基金实时持仓，请结合基金定期报告和指数编制方案核验。" : "题材不等于业绩事实，请结合公司公告核验。"}</p>
        </section>

        <section className="panel analysis-card risks-card">
          <CardTitle number="05" title="主要风险" source="按数据可见范围整理" />
          <ol>{explanation.risks.map((risk, index) => <li key={risk}><span>{index + 1}</span><div><p>{risk}</p></div></li>)}</ol>
          {explanation.missingInformation.length > 0 && <p className="source-warning">仍缺少：{explanation.missingInformation.join("、")}</p>}
        </section>

        <section className="panel analysis-card price-plan-card">
          <CardTitle number="06" title="价格参考" source="参考情景，不是买卖建议" />
          <p className="risk-unit-note"><b>先看风险，再看目标：</b>1R就是当前价到风险观察线的距离，2R是这段距离的两倍。</p>
          <div className="price-scenarios">
            <div className="risk"><span>20日风险观察线</span><strong>{price(quote.support)}</strong><p>近期低点，跌破后重新检查原判断。</p></div>
            <div><span>第一目标参考</span><strong>{price(quote.target1)}</strong><p>以当前价到风险线的距离计算1R。</p></div>
            <div><span>第二目标参考</span><strong>{price(quote.target2)}</strong><p>以相同风险距离计算2R。</p></div>
          </div>
          <div className="price-disclaimer">数据来源：<a href={analysis.source.url} target="_blank" rel="noreferrer">{analysis.source.name}</a> · 获取于 {new Date(analysis.source.fetchedAt).toLocaleString("zh-CN")}</div>
        </section>
      </div>

      <div className="research-grid">
        <AnalysisHistory symbol={stock.code} currentPrice={quote.price} />
        <AnnouncementPanel stock={stock} />
      </div>

      <section className="decision-bar">
        <div><span className="eyebrow">现在由你决定</span><h3>这只股票下一步怎么处理？</h3></div>
        <div><button className="soft-button" onClick={onWatch}>{watched ? <><CheckCircle size={15} weight="fill" />已关注</> : <><Star size={15} />加入关注</>}</button>{canSell && <button className="soft-button" onClick={onSell}>记录卖出</button>}<button className="primary-button" onClick={onBuy}>我已买入</button></div>
      </section>
    </div>
  );
}

function EvidencePanel({ analysis, position }: { analysis: Analysis; position: Position | null }) {
  const { quote, financials, source } = analysis;
  const evidence = [
    {
      label: "行情位置",
      value: `${price(quote.price)} · 20日均线${price(quote.ma20)}`,
      detail: `当前价位于20日均线${quote.price >= quote.ma20 ? "上方" : "下方"}，行情时间${quote.marketTime ? new Date(quote.marketTime).toLocaleString("zh-CN") : "未提供"}。`,
      confidence: "高",
      source: source.name,
    },
    {
      label: "风险尺度",
      value: `观察线${price(quote.support)} · 波动${quote.volatility.toFixed(2)}%`,
      detail: "观察线来自近期低点，波动率来自近期日涨跌幅，均为程序计算。",
      confidence: "高",
      source: "公开行情 · 程序计算",
    },
    {
      label: "财务完整度",
      value: [financials.revenueGrowth, financials.profitGrowth, financials.pe, financials.roe].filter((value) => value !== null).length >= 3 ? "主要字段可用" : "关键字段不足",
      detail: "财务数据用于初筛；报告期、口径和一次性损益仍需结合公告核验。",
      confidence: "中",
      source: "公开财务接口",
    },
  ];

  if (position) {
    const returnPercent = ((quote.price * 10_000 / position.averageCostTenThousandths) - 1) * 100;
    evidence.unshift({
      label: "我的持仓",
      value: `${position.quantity}股 · 成本${tenThousandthsPrice(position.averageCostTenThousandths)}`,
      detail: `按当前参考价估算为${returnPercent >= 0 ? "+" : ""}${returnPercent.toFixed(2)}%，不含未来费用和滑点。`,
      confidence: "高",
      source: "我的交易记录",
    });
  }

  return (
    <section className="panel evidence-panel">
      <div className="evidence-heading">
        <div><span className="eyebrow">结论从哪里来</span><h3>关键证据与可信度</h3></div>
        <p>数字、时间和缺口分开呈现，避免把推测当事实。</p>
      </div>
      <div className="evidence-grid">
        {evidence.map((item) => (
          <article key={item.label}>
            <div><span>{item.label}</span><b className={item.confidence === "高" ? "high" : "medium"}>{item.confidence}可信</b></div>
            <strong>{item.value}</strong>
            <p>{item.detail}</p>
            <small>来源：{item.source}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

function SmartAssistant({ analysis, position, portfolioInsights }: {
  analysis: Analysis;
  position: Position | null;
  portfolioInsights: PortfolioInsights;
}) {
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([{
    role: "assistant",
    content: `我已经读完${analysis.stock.name}的当前分析。你可以继续追问风险、财务，${position ? "也可以让我结合你的持仓成本解释。" : "记录持仓后还能获得个性化解释。"}`,
  }]);

  const positionContext = position ? {
    quantity: position.quantity,
    averageCost: position.averageCostTenThousandths / 10_000,
    returnPercent: ((analysis.quote.price * 10_000 / position.averageCostTenThousandths) - 1) * 100,
    stockPositionPercent: portfolioInsights.positions.find((item) => item.symbol === position.symbol)?.allocationPercent ?? null,
  } : null;

  async function ask(text: string) {
    const clean = text.trim();
    if (!clean || asking) return;
    const history = messages.slice(-8);
    setMessages((current) => [...current, { role: "user", content: clean }]);
    setQuestion("");
    setAsking(true);
    try {
      const result = await jsonRequest<{ answer: string; mode: string }>("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question: clean,
          messages: history,
          context: {
            stock: {
              code: analysis.stock.code,
              name: analysis.stock.name,
              industry: analysis.stock.industry,
              instrumentType: analysis.stock.instrumentType,
            },
            quote: {
              price: analysis.quote.price,
              changePercent: analysis.quote.changePercent,
              ma20: analysis.quote.ma20,
              support: analysis.quote.support,
              resistance: analysis.quote.resistance,
              volatility: analysis.quote.volatility,
              marketTime: analysis.quote.marketTime,
            },
            financials: {
              revenueGrowth: analysis.financials.revenueGrowth,
              profitGrowth: analysis.financials.profitGrowth,
              debtRatio: analysis.financials.debtRatio,
              pe: analysis.financials.pe,
              pb: analysis.financials.pb,
              roe: analysis.financials.roe,
            },
            summary: analysis.explanation.summary,
            risks: analysis.explanation.risks,
            missingInformation: analysis.explanation.missingInformation,
            source: analysis.source,
            position: positionContext,
            portfolio: {
              totalAssets: portfolioInsights.totalAssetsCents === null ? null : portfolioInsights.totalAssetsCents / 100,
              cash: portfolioInsights.cashCents === null ? null : portfolioInsights.cashCents / 100,
              totalPositionPercent: portfolioInsights.totalPositionPercent,
              totalProfitPercent: portfolioInsights.totalProfitPercent,
            },
          },
        }),
      });
      setMessages((current) => [...current, { role: "assistant", content: result.answer }]);
    } catch (error) {
      setMessages((current) => [...current, {
        role: "assistant",
        content: error instanceof Error ? error.message : "这次追问暂时没有回答，请稍后重试。",
      }]);
    } finally {
      setAsking(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void ask(question);
  }

  const prompts = position
    ? ["当前仓位是否允许加仓？", "结合我的成本怎么看？", "主要风险是什么？"]
    : ["当前仓位是否允许买入？", "主要风险是什么？", "财务数据说明了什么？"];

  return (
    <section className="panel smart-assistant">
      <div className="assistant-heading">
        <div><span className="eyebrow">可连续追问</span><h3>智能复盘助手</h3></div>
        <span className="assistant-context">{position ? "已结合我的持仓" : "当前未记录持仓"}</span>
      </div>
      <div className="assistant-messages" aria-live="polite">
        {messages.map((message, index) => (
          <div className={`assistant-message ${message.role}`} key={`${message.role}-${index}`}>
            <b>{message.role === "assistant" ? "助手" : "我"}</b>
            <p>{message.content}</p>
          </div>
        ))}
        {asking && <div className="assistant-message assistant"><b>助手</b><p>正在核对当前证据和对话上下文…</p></div>}
      </div>
      <div className="assistant-prompts">
        {prompts.map((prompt) => <button key={prompt} type="button" disabled={asking} onClick={() => void ask(prompt)}>{prompt}</button>)}
      </div>
      <form className="assistant-form" onSubmit={submit}>
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          maxLength={300}
          placeholder={`继续问${analysis.stock.name}，例如“这个结论依据是什么？”`}
          aria-label="向智能复盘助手提问"
        />
        <button type="submit" disabled={asking || !question.trim()}>{asking ? "思考中…" : "发送"}</button>
      </form>
      <small className="assistant-disclaimer">回答仅基于当前页面数据与个人记录，不构成投资建议。</small>
    </section>
  );
}

function MarketChart({ analysis }: { analysis: Analysis }) {
  const [period, setPeriod] = useState<MarketPeriod>("day");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [pointerPrice, setPointerPrice] = useState<number | null>(null);
  const rows = useMemo(
    () => aggregateMarketHistory(analysis.history, period).slice(-60),
    [analysis.history, period],
  );
  const width = 900;
  const priceHeight = 190;
  const volumeTop = 215;
  const chartVolumeHeight = 55;
  const minPrice = Math.min(...rows.map((row) => row.low));
  const maxPrice = Math.max(...rows.map((row) => row.high));
  const priceRange = Math.max(maxPrice - minPrice, 0.01);
  const maxVolume = Math.max(...rows.map((row) => row.volume), 1);
  const volumeHighlight = rows.length
    ? rows.reduce((largest, row) => row.volume > largest.volume ? row : largest)
    : null;
  const step = width / Math.max(rows.length, 1);
  const candleWidth = Math.max(2, step * 0.55);
  const x = (index: number) => index * step + step / 2;
  const y = (value: number) => 12 + ((maxPrice - value) / priceRange) * (priceHeight - 24);
  const linePoints = (key: "ma5" | "ma20" | "ma60") => rows
    .map((row, index) => row[key] === null ? null : `${x(index).toFixed(1)},${y(row[key] as number).toFixed(1)}`)
    .filter(Boolean)
    .join(" ");
  const selectedRow = selectedIndex === null ? null : rows[selectedIndex];
  const previousClose = selectedIndex !== null && selectedIndex > 0 ? rows[selectedIndex - 1].close : null;
  const selectedChange = selectedRow && previousClose
    ? ((selectedRow.close / previousClose) - 1) * 100
    : null;
  const tooltipX = selectedIndex === null
    ? 0
    : x(selectedIndex) > width / 2 ? x(selectedIndex) - 230 : x(selectedIndex) + 12;
  const crosshairPrice = pointerPrice ?? selectedRow?.close ?? null;
  const crosshairY = crosshairPrice === null ? null : y(crosshairPrice);
  const crosshairLabel = crosshairPrice === null ? "" : price(crosshairPrice);
  const priceLabelWidth = Math.max(62, crosshairLabel.length * 7 + 14);
  const periodLabel = period === "day" ? "日K" : period === "week" ? "周K" : "月K";
  const latestRow = rows.at(-1);

  function selectAtPointer(event: ReactPointerEvent<SVGSVGElement>) {
    const matrix = event.currentTarget.getScreenCTM();
    if (!matrix) return;
    const point = event.currentTarget.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const pointer = point.matrixTransform(matrix.inverse());
    if (pointer.x < 0 || pointer.x > width) {
      setSelectedIndex(null);
      setPointerPrice(null);
      return;
    }
    const index = Math.min(rows.length - 1, Math.floor(Math.min(pointer.x, width - Number.EPSILON) / step));
    setSelectedIndex(index);
    const priceTop = 12;
    const priceBottom = priceHeight - 12;
    if (pointer.y < priceTop || pointer.y > priceBottom) {
      setPointerPrice(null);
      return;
    }
    const value = maxPrice - ((pointer.y - priceTop) / (priceBottom - priceTop)) * priceRange;
    setPointerPrice(Math.max(minPrice, Math.min(maxPrice, value)));
  }

  function navigateChart(event: ReactKeyboardEvent<SVGSVGElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(event.key)) return;
    event.preventDefault();
    setPointerPrice(null);
    if (event.key === "Escape") return setSelectedIndex(null);
    if (event.key === "Home") return setSelectedIndex(0);
    if (event.key === "End") return setSelectedIndex(rows.length - 1);
    const current = selectedIndex ?? rows.length - 1;
    setSelectedIndex(Math.max(0, Math.min(rows.length - 1, current + (event.key === "ArrowLeft" ? -1 : 1))));
  }

  function changePeriod(nextPeriod: MarketPeriod) {
    setPeriod(nextPeriod);
    setSelectedIndex(null);
    setPointerPrice(null);
  }

  return (
    <section className="panel market-chart-card">
      <div className="chart-heading">
        <div><span className="eyebrow">{periodLabel} · 近{rows.length}根</span><h3>K线与成交量</h3></div>
        <div className="chart-heading-actions">
          <div className="chart-period-tabs" aria-label="K线周期">
            {(["day", "week", "month"] as MarketPeriod[]).map((item) => (
              <button
                type="button"
                key={item}
                className={period === item ? "active" : ""}
                aria-pressed={period === item}
                onClick={() => changePeriod(item)}
              >
                {item === "day" ? "日K" : item === "week" ? "周K" : "月K"}
              </button>
            ))}
          </div>
          <div className="chart-legend"><span className="ma5">MA5</span><span className="ma20">MA20</span><span className="ma60">MA60</span></div>
        </div>
      </div>
      <p className="chart-interaction-hint">移动鼠标查看日期与水平线对应价格，点按或使用左右方向键切换K线。</p>
      <svg
        className="market-chart"
        viewBox={`0 0 ${width} 280`}
        role="img"
        tabIndex={0}
        aria-label={`${analysis.stock.name}${periodLabel}、成交量和均线。移动鼠标、点按或使用左右方向键查看每根K线数据。`}
        onPointerMove={selectAtPointer}
        onPointerDown={selectAtPointer}
        onPointerLeave={(event) => {
          if (event.pointerType === "touch") return;
          setSelectedIndex(null);
          setPointerPrice(null);
        }}
        onKeyDown={navigateChart}
      >
        <line x1="0" y1={priceHeight} x2={width} y2={priceHeight} className="chart-axis" />
        {rows.map((row, index) => {
          const rising = row.close >= row.open;
          const candleY = Math.min(y(row.open), y(row.close));
          const candleHeight = Math.max(1.5, Math.abs(y(row.open) - y(row.close)));
          const barHeight = row.volume / maxVolume * chartVolumeHeight;
          return (
            <g key={row.date}>
              <line x1={x(index)} x2={x(index)} y1={y(row.high)} y2={y(row.low)} className={rising ? "candle-up" : "candle-down"} />
              <rect x={x(index) - candleWidth / 2} y={candleY} width={candleWidth} height={candleHeight} className={rising ? "candle-up" : "candle-down"} />
              <rect x={x(index) - candleWidth / 2} y={volumeTop + chartVolumeHeight - barHeight} width={candleWidth} height={barHeight} className={rising ? "volume-up" : "volume-down"} />
            </g>
          );
        })}
        <polyline points={linePoints("ma5")} className="ma-line ma5-line" />
        <polyline points={linePoints("ma20")} className="ma-line ma20-line" />
        <polyline points={linePoints("ma60")} className="ma-line ma60-line" />
        {selectedRow && selectedIndex !== null && (
          <g className="chart-selection" pointerEvents="none">
            <line x1={x(selectedIndex)} x2={x(selectedIndex)} y1="4" y2="270" className="chart-crosshair" />
            {crosshairY !== null && (
              <>
                <line x1="0" x2={width} y1={crosshairY} y2={crosshairY} className="chart-crosshair chart-crosshair-horizontal" />
                <g
                  transform={`translate(${width - priceLabelWidth}, ${Math.max(2, Math.min(priceHeight - 22, crosshairY - 10))})`}
                  className="chart-price-label"
                >
                  <rect width={priceLabelWidth} height="20" rx="5" />
                  <text x={priceLabelWidth - 7} y="14" textAnchor="end">{crosshairLabel}</text>
                </g>
              </>
            )}
            <circle cx={x(selectedIndex)} cy={y(selectedRow.close)} r="4" className="chart-selection-dot" />
            <g transform={`translate(${tooltipX}, 8)`} className="chart-tooltip">
              <rect width="218" height="126" rx="9" />
              <text x="12" y="20" className="chart-tooltip-date">{selectedRow.date}</text>
              <text x="206" y="20" textAnchor="end" className={selectedChange !== null && selectedChange < 0 ? "chart-tooltip-down" : "chart-tooltip-up"}>
                {selectedChange === null ? "—" : `${selectedChange >= 0 ? "+" : ""}${selectedChange.toFixed(2)}%`}
              </text>
              <text x="12" y="43">开 <tspan>{price(selectedRow.open)}</tspan></text>
              <text x="112" y="43">高 <tspan>{price(selectedRow.high)}</tspan></text>
              <text x="12" y="63">低 <tspan>{price(selectedRow.low)}</tspan></text>
              <text x="112" y="63">收 <tspan>{price(selectedRow.close)}</tspan></text>
              <text x="12" y="84">成交量 <tspan>{compactVolume(selectedRow.volume)}</tspan></text>
              <text x="12" y="106" className="chart-tooltip-ma5">MA5 <tspan>{selectedRow.ma5 === null ? "—" : price(selectedRow.ma5)}</tspan></text>
              <text x="82" y="106" className="chart-tooltip-ma20">MA20 <tspan>{selectedRow.ma20 === null ? "—" : price(selectedRow.ma20)}</tspan></text>
              <text x="158" y="106" className="chart-tooltip-ma60">MA60 <tspan>{selectedRow.ma60 === null ? "—" : price(selectedRow.ma60)}</tspan></text>
            </g>
          </g>
        )}
      </svg>
      <div className="chart-summary">
        {selectedRow ? (
          <>
            <span>选中日期 <b>{selectedRow.date}</b></span>
            <span>开盘 / 收盘 <b>{price(selectedRow.open)} / {price(selectedRow.close)}</b></span>
            <span>最高 / 最低 <b>{price(selectedRow.high)} / {price(selectedRow.low)}</b></span>
            <span>成交量 <b>{compactVolume(selectedRow.volume)}</b></span>
          </>
        ) : (
          <>
            <span>MA5 <b>{latestRow?.ma5 === null || latestRow?.ma5 === undefined ? "暂无" : price(latestRow.ma5)}</b></span>
            <span>MA20 <b>{latestRow?.ma20 === null || latestRow?.ma20 === undefined ? "暂无" : price(latestRow.ma20)}</b></span>
            <span>MA60 <b>{latestRow?.ma60 === null || latestRow?.ma60 === undefined ? "暂无" : price(latestRow.ma60)}</b></span>
            <span>最大成交量日 <b>{volumeHighlight?.date ?? "暂无"}</b></span>
          </>
        )}
      </div>
    </section>
  );
}

type HistoryReport = {
  id: number;
  priceCents: number;
  priceMillis: number | null;
  marketTime: string | null;
  source: string;
  mode: string;
  summary: string;
  createdAt: string;
};

function AnalysisHistory({ symbol, currentPrice }: { symbol: string; currentPrice: number }) {
  const [reports, setReports] = useState<HistoryReport[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try {
        const result = await jsonRequest<{ reports: HistoryReport[] }>(`/api/analysis-history?symbol=${symbol}`);
        setReports(result.reports);
      } catch (historyError) {
        setError(historyError instanceof Error ? historyError.message : "分析历史读取失败");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [symbol]);

  return (
    <section className="panel research-card">
      <CardTitle number="07" title="历史分析" source="保存当时的价格与判断" />
      {reports.length ? reports.slice(0, 5).map((report) => {
        const change = report.priceMillis === null
          ? null
          : ((currentPrice * 1000 / report.priceMillis) - 1) * 100;
        return (
          <article className="history-item" key={report.id}>
            <div><b>{new Date(report.createdAt).toLocaleString("zh-CN")}</b><span>{report.mode === "deepseek" ? "AI" : "自动解释"} · {report.priceMillis === null
              ? <>旧记录约{money(report.priceCents)} · <i className="legacy-precision">精度不足，不计算涨跌</i></>
              : <>当时{millisPrice(report.priceMillis)} · 至今<span className={(change ?? 0) >= 0 ? "up" : "down"}>{(change ?? 0) >= 0 ? "+" : ""}{(change ?? 0).toFixed(2)}%</span></>
            }</span></div>
            <p>{report.summary}</p>
          </article>
        );
      }) : <div className="empty-inline">{error || "首次分析已保存，重新进入后可在这里对比。"}</div>}
    </section>
  );
}

type AnnouncementNote = {
  id: number;
  title: string;
  sourceUrl: string;
  totalPages: number;
  summary: string;
  risks: string[];
  mode: string;
  createdAt: string;
};

function AnnouncementPanel({ stock }: { stock: Analysis["stock"] }) {
  const [notes, setNotes] = useState<AnnouncementNote[]>([]);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");

  const loadNotes = useCallback(async () => {
    try {
      const result = await jsonRequest<{ notes: AnnouncementNote[] }>(`/api/announcements?symbol=${stock.code}`);
      setNotes(result.notes);
    } catch (noteError) {
      setMessage(noteError instanceof Error ? noteError.message : "公告摘要读取失败");
    }
  }, [stock.code]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadNotes(), 0);
    return () => window.clearTimeout(timer);
  }, [loadNotes]);

  async function summarize(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUploading(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    form.set("symbol", stock.code);
    form.set("name", stock.name);
    try {
      const response = await fetch("/api/announcements", { method: "POST", body: form });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "公告摘要失败");
      event.currentTarget.reset();
      await loadNotes();
      setMessage("公告摘要已保存");
    } catch (summaryError) {
      setMessage(summaryError instanceof Error ? summaryError.message : "公告摘要失败");
    } finally {
      setUploading(false);
    }
  }

  async function removeNote(id: number) {
    try {
      await jsonRequest(`/api/announcements?symbol=${stock.code}&id=${id}`, { method: "DELETE" });
      await loadNotes();
      setMessage("公告摘要已删除");
    } catch (removeError) {
      setMessage(removeError instanceof Error ? removeError.message : "公告摘要删除失败");
    }
  }

  return (
    <section className="panel research-card announcement-card">
      <CardTitle number="08" title="官方公告" source="官方原文优先 · AI只做摘要" />
      <div className="official-links">
        <a href={`https://www.cninfo.com.cn/new/fulltextSearch?keyWord=${stock.code}`} target="_blank" rel="noreferrer">巨潮资讯</a>
        <a href="https://www.sse.com.cn/disclosure/listedinfo/announcement/" target="_blank" rel="noreferrer">上交所公告</a>
        <a href="https://www.szse.cn/disclosure/listed/notice/index.html" target="_blank" rel="noreferrer">深交所公告</a>
      </div>
      <form className="announcement-form" onSubmit={summarize}>
        <label>公告标题<input name="title" required maxLength={120} placeholder="例如：2026年半年度报告" /></label>
        <label>官方PDF链接（可选）<input name="sourceUrl" type="url" placeholder="仅支持巨潮、上交所、深交所HTTPS链接" /></label>
        <label>或上传PDF（8MB以内）<input name="file" type="file" accept="application/pdf" /></label>
        <button className="primary-button" disabled={uploading}>{uploading ? "正在提取并总结…" : "生成公告摘要"}</button>
      </form>
      {message && <p className="form-message" role="status">{message}</p>}
      <div className="announcement-list">
        {notes.slice(0, 3).map((note) => (
          <article key={note.id}>
            <div><b>{note.title}</b><span>{note.mode === "deepseek" ? "AI摘要" : "自动摘要"} · {note.totalPages}页</span></div>
            <p>{note.summary}</p>
            {note.risks.length > 0 && <small>需要核验：{note.risks.join("；")}</small>}
            <div className="announcement-actions">
              {note.sourceUrl && <a href={note.sourceUrl} target="_blank" rel="noreferrer">查看原文 →</a>}
              <button type="button" onClick={() => void removeNote(note.id)}>删除摘要</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function formatMarketCap(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (value >= 1e12) return `${(value / 1e12).toFixed(2)}万亿`;
  if (value >= 1e8) return `${(value / 1e8).toFixed(2)}亿`;
  if (value >= 1e4) return `${(value / 1e4).toFixed(2)}万`;
  return value.toLocaleString("zh-CN");
}

function Metric({ label, value, suffix = "", moneyValue = false, marketCapValue = false, percentValue = false, help }: {
  label: string;
  value: number | null;
  suffix?: string;
  moneyValue?: boolean;
  marketCapValue?: boolean;
  percentValue?: boolean;
  help?: string;
}) {
  let content = "暂无";
  if (value !== null) {
    if (marketCapValue) content = formatMarketCap(value);
    else if (percentValue) content = `${(value * 100).toFixed(1)}%`;
    else if (moneyValue) content = price(value);
    else content = `${value >= 0 && suffix === "%" ? "+" : ""}${value.toFixed(1)}${suffix}`;
  }
  return <div><span>{label}</span><strong className={value !== null && value < 0 ? "down" : "neutral"}>{content}</strong><small>{help ?? (value === null ? "数据不足" : "最新可用数据")}</small></div>;
}

function Watchlist({ items, quotes, onSearch, onAnalyze, onRemove, onSaved }: {
  items: WatchItem[];
  quotes: Record<string, Analysis>;
  onSearch: () => void;
  onAnalyze: (symbol: string) => void;
  onRemove: (symbol: string) => void;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function saveCondition(event: FormEvent<HTMLFormElement>, symbol: string) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      await jsonRequest("/api/watchlist", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol,
          conditionText: data.get("conditionText"),
          status: data.get("status"),
        }),
      });
      setEditing(null);
      setMessage("观察条件已更新");
      onSaved();
    } catch (saveError) {
      setMessage(saveError instanceof Error ? saveError.message : "观察条件保存失败");
    }
  }

  return (
    <div className="page-content inner-page">
      <section className="page-intro"><div><span className="eyebrow">先研究，再决定</span><h2>我的关注</h2><p>每只股票都保留一个明确的等待条件。</p></div><button className="primary-button" onClick={onSearch}><Plus size={16} weight="bold" />查找股票</button></section>
      {items.length ? (
        <div className="watch-cards">
          {items.map((item) => {
            const quote = quotes[item.symbol]?.quote;
            return (
              <article className="panel watch-card" key={item.symbol}>
                <div className="watch-card-top"><span className="stock-avatar">{item.name.slice(0, 1)}</span><span className={`watch-state ${item.status === "暂停" ? "paused" : ""}`}>{item.status}</span></div>
                <h3>{item.name}</h3><p>{item.symbol} · {quotes[item.symbol]?.stock.industry ?? "行业信息更新中"}</p>
                <div className="watch-price"><strong>{quote ? price(quote.price) : "行情待更新"}</strong>{quote && <span className={quote.changePercent >= 0 ? "up" : "down"}>{quote.changePercent.toFixed(2)}%</span>}</div>
                {editing === item.symbol ? (
                  <form className="watch-edit-form" onSubmit={(event) => void saveCondition(event, item.symbol)}>
                    <label>观察状态<select name="status" defaultValue={item.status}><option>研究中</option><option>等待条件</option><option>已买入</option><option>暂停</option></select></label>
                    <label>行动条件<textarea name="conditionText" defaultValue={item.conditionText} required maxLength={300} /></label>
                    <div><button type="button" onClick={() => setEditing(null)}>取消</button><button className="primary-button">保存</button></div>
                  </form>
                ) : (
                  <>
                    <div className="watch-note"><span>我的条件</span><p>{item.conditionText}</p></div>
                    <small className="reviewed-time">{item.lastReviewedAt ? `最近检查：${new Date(item.lastReviewedAt).toLocaleDateString("zh-CN")}` : "尚未检查"}</small>
                    <div className="card-actions"><button className="text-button" onClick={() => onAnalyze(item.symbol)}>查看分析 →</button><button className="text-button" onClick={() => setEditing(item.symbol)}>编辑条件</button><button className="danger-link" onClick={() => onRemove(item.symbol)}>移出关注</button></div>
                  </>
                )}
              </article>
            );
          })}
        </div>
      ) : <div className="empty-state">关注列表还是空的。查一只股票后点击“加入关注”。</div>}
      {message && <div className="toast inline-toast" role="status">{message}</div>}
    </div>
  );
}

function Trades({ trades, reviews, onBuy, onSell, onReview }: {
  trades: Trade[];
  reviews: Review[];
  onBuy: () => void;
  onSell: () => void;
  onReview: (cycleEndTradeId: number) => void;
}) {
  const portfolio = calculatePortfolio(trades);
  const cycles = buildTradeCycles(trades);
  const completedCycles = cycles.filter((cycle) => cycle.endTradeId !== null);
  const cycleByTradeId = new Map(cycles.flatMap((cycle) =>
    cycle.trades.map((trade) => [trade.id, cycle] as const)
  ));
  const reviewed = new Set(reviews.flatMap((review) => review.cycleEndTradeId ? [review.cycleEndTradeId] : []));
  for (const review of reviews.filter((item) => item.cycleEndTradeId === null)) {
    const legacyCycle = [...completedCycles]
      .reverse()
      .find((cycle) => cycle.symbol === review.symbol && cycle.endTradeId && !reviewed.has(cycle.endTradeId));
    if (legacyCycle?.endTradeId) reviewed.add(legacyCycle.endTradeId);
  }
  const winningCycles = completedCycles.filter((cycle) => cycle.realizedCents > 0).length;

  return (
    <div className="page-content inner-page">
      <section className="page-intro"><div><span className="eyebrow">真实记录，才能真实复盘</span><h2>交易记录</h2><p>只有完全清仓才会生成待复盘任务；部分卖出仍属于同一持仓周期。</p></div><div className="intro-actions"><button className="soft-button" onClick={onSell} disabled={!portfolio.positions.length}>记录卖出</button><button className="primary-button" onClick={onBuy}><Plus size={16} weight="bold" />记录买入</button></div></section>
      <div className="summary-strip">
        <div><span>交易记录</span><strong>{trades.length}</strong></div>
        <div><span>当前持仓</span><strong>{portfolio.positions.length}</strong></div>
        <div><span>已实现盈亏</span><strong className={portfolio.realizedCents >= 0 ? "up" : "down"}>{money(portfolio.realizedCents)}</strong></div>
        <div><span>完整交易胜率</span><strong>{completedCycles.length ? `${Math.round(winningCycles / completedCycles.length * 100)}%` : "暂无"}</strong></div>
      </div>
      {trades.length ? (
        <section className="panel trade-list">
          <div className="trade-head"><span>日期</span><span>股票</span><span>操作</span><span>原因</span><span>状态</span></div>
          {trades.map((trade) => {
            const cycle = cycleByTradeId.get(trade.id);
            const hasReview = cycle?.endTradeId ? reviewed.has(cycle.endTradeId) : false;
            return (
              <div className="trade-row" key={trade.id}>
                <span><b>{trade.tradeDate}</b><small>{trade.quantity}股</small></span>
                <span><b>{trade.name}</b><small>{trade.symbol}</small></span>
                <span><b className={`side ${trade.side === "买入" ? "buy" : "sell"}`}>{trade.side}</b><small>{tradePrice(trade)}</small></span>
                <span className="trade-reason">{trade.reason}</span>
                <span>
                  {cycle?.endTradeId === null
                    ? <i className="holding-label">持仓中</i>
                    : hasReview
                      ? <i className="holding-label complete">已复盘</i>
                      : cycle?.endTradeId === trade.id
                        ? <button className="review-button" onClick={() => onReview(cycle.endTradeId!)}>去复盘</button>
                        : <i className="holding-label pending">待复盘</i>}
                </span>
              </div>
            );
          })}
        </section>
      ) : <div className="empty-state">还没有交易记录。保存成功后刷新页面也不会丢失。</div>}
    </div>
  );
}

function Settings({ status, initialCapitalCents, alerts, section, onSection, onDisable, onNotifications, onSaveCapital }: {
  status: Status | null;
  initialCapitalCents: number | null;
  alerts: AlertRule[];
  section: string | null;
  onSection: (section: string | null) => void;
  onDisable: (id: number) => void;
  onNotifications: () => void;
  onSaveCapital: (initialCapital: number) => Promise<void>;
}) {
  const notificationState = typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported";
  const cards = [
    { id: "account", icon: "仓", title: "账户资金", text: "设置初始资金后，系统才能计算现金、总仓位和账户总盈亏。", state: initialCapitalCents === null ? "待设置" : money(initialCapitalCents) },
    { id: "ai", icon: "AI", title: "AI分析", text: status?.deepseekConfigured ? "AI分析已由服务端安全配置。" : "当前未配置AI密钥，使用基于真实数据的自动解释。", state: status?.deepseekConfigured ? "已连接" : "自动模式" },
    { id: "data", icon: "数", title: "数据来源", text: `${status?.dataSource ?? "公开行情"}。结果显示获取时间，失败时不会伪装成最新。`, state: "无需账号" },
    { id: "alerts", icon: "醒", title: "提醒管理", text: `${status?.reminderMode ?? "页面打开期间检查"}。重要止损仍需在券商App重复设置。`, state: `${alerts.filter((item) => item.enabled).length}条启用` },
    { id: "privacy", icon: "私", title: "隐私与备份", text: "交易数据保存在私有数据库中，可随时下载JSON备份。", state: "默认私有" },
  ];

  return (
    <div className="page-content inner-page">
      <section className="page-intro"><div><span className="eyebrow">所有边界都说清楚</span><h2>设置</h2><p>这里展示真实连接状态，不再用演示文案冒充功能。</p></div></section>
      <div className="settings-grid">
        {cards.map((card) => (
          <article className="panel setting-card" key={card.id}>
            <span className={`setting-icon ${card.id}`}>{card.icon}</span>
            <div className="setting-copy"><h3>{card.title}</h3><p>{card.text}</p><span className="connected"><CheckCircle size={13} weight="fill" />{card.state}</span></div>
            <button className="text-button" onClick={() => onSection(section === card.id ? null : card.id)}>{section === card.id ? "收起" : "查看"}</button>
          </article>
        ))}
      </div>
      {section === "account" && <CapitalSettings initialCapitalCents={initialCapitalCents} onSave={onSaveCapital} />}
      {section === "ai" && <section className="panel settings-detail"><h3>AI连接状态</h3><p>{status?.deepseekConfigured ? "AI API密钥只在服务端读取，浏览器无法看到。" : "没有AI密钥时，系统不会假装调用AI，而是明确显示“自动解释”。"}</p></section>}
      {section === "data" && <section className="panel settings-detail"><h3>数据原则</h3><p>行情来自公开接口，可能延迟或暂时不可用。每次分析都记录来源、行情时间和获取时间；财务数据缺失时显示“暂无”，不会补数字。</p></section>}
      {section === "alerts" && (
        <section className="panel settings-detail">
          <div className="settings-detail-head"><div><h3>提醒管理</h3><p>浏览器权限：{notificationState}</p></div><button className="primary-button" onClick={onNotifications}>申请浏览器通知</button></div>
          {alerts.length ? alerts.map((alert) => <div className="alert-row" key={alert.id}><span><b>{alert.name} · {alert.type}</b><small>{alertPrice(alert)} · {alert.enabled ? "启用" : "已停用"}</small></span>{alert.enabled && <button className="danger-link" onClick={() => onDisable(alert.id)}>停用</button>}</div>) : <p>暂无提醒规则。</p>}
        </section>
      )}
      {section === "privacy" && <section className="panel settings-detail"><h3>导出个人数据</h3><p>备份包含交易、关注、提醒与复盘，不包含任何API密钥。</p><a className="primary-button download-link" href="/api/export">下载JSON备份</a></section>}
      <section className="panel boundary-card">
        <span>产品边界</span>
        <div><p><CheckCircle size={14} />不自动交易</p><p><CheckCircle size={14} />不荐股</p><p><CheckCircle size={14} />不承诺提醒必达</p><p><CheckCircle size={14} />数据缺失会明说</p><p><CheckCircle size={14} />最终决定由你作出</p><p><CheckCircle size={14} />重要止损在券商App重复设置</p></div>
      </section>
    </div>
  );
}

function CapitalSettings({ initialCapitalCents, onSave }: {
  initialCapitalCents: number | null;
  onSave: (initialCapital: number) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = Number(new FormData(event.currentTarget).get("initialCapital"));
    setSaving(true);
    setMessage("");
    try {
      await onSave(value);
      setMessage("已保存，首页仓位与盈亏将按新的资金基准重新计算。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel settings-detail">
      <h3>账户初始资金</h3>
      <p>填写开始使用本软件时账户内用于股票交易的总资金。现金按交易流水自动推算；发生场外转入或转出后，请在这里更新资金基准。</p>
      <form className="capital-form" onSubmit={submit}>
        <label>初始资金（元）<input name="initialCapital" type="number" min="100" max="1000000000" step="0.01" defaultValue={initialCapitalCents === null ? "" : initialCapitalCents / 100} placeholder="例如 100000" required /></label>
        <button className="primary-button" type="submit" disabled={saving}>{saving ? "保存中…" : "保存资金基准"}</button>
      </form>
      {message && <p className="form-message" role="status">{message}</p>}
    </section>
  );
}

function TradeModal({ mode, stock, positions, onClose, onSubmit }: {
  mode: TradeMode;
  stock: { code?: string; symbol?: string; name: string } | null;
  positions: ReturnType<typeof calculatePortfolio>["positions"];
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  const firstInput = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const defaultPosition = mode === "sell" ? positions[0] : null;
  const symbol = stock?.code ?? stock?.symbol ?? defaultPosition?.symbol ?? "";
  const name = stock?.name ?? defaultPosition?.name ?? "";

  useEffect(() => {
    firstInput.current?.focus();
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    if (saving) return;
    setSaving(true);
    await onSubmit(event);
    setSaving(false);
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="trade-modal-title">
        <header><div><span className="eyebrow">{mode === "buy" ? "写下当时的决定" : "记录真实的退出"}</span><h2 id="trade-modal-title">记录{mode === "buy" ? "买入" : "卖出"}</h2></div><button onClick={onClose} aria-label="关闭">×</button></header>
        <form onSubmit={submit}>
          <div className="form-grid">
            <label>股票代码<input ref={firstInput} name="symbol" defaultValue={symbol} pattern="\d{6}" required /></label>
            <label>股票名称<input name="name" defaultValue={name} required maxLength={30} /></label>
            <label>{mode === "buy" ? "买入" : "卖出"}价格<input name="price" type="number" min="0" step="any" required /></label>
            <label>数量（股）<input name="quantity" type="number" min="1" step="1" required /></label>
            <label>交易日期<input name="tradeDate" type="date" defaultValue={localIsoDate()} max={localIsoDate()} required /></label>
            <label>总费用（可选）<input name="fee" type="number" min="0" step="0.01" defaultValue="0" /></label>
            {mode === "buy" && (
              <label>最多接受亏损（元）
                <input name="maxLoss" type="number" min="0" step="0.01" placeholder="例如 500" />
                <small className="field-help">如果判断错了，这笔交易最多愿意亏多少钱？请填你能实际执行的金额。</small>
              </label>
            )}
          </div>
          <fieldset><legend>为什么{mode === "buy" ? "买" : "卖"}？</legend><div className="reason-options">{(mode === "buy" ? buyReasons : sellReasons).map((reason) => <label key={reason}><input className="visually-hidden" type="radio" name="reason" value={reason} required /><span>{reason}</span></label>)}</div></fieldset>
          {mode === "buy" && <div className="calculation-tip"><b>1R是什么？</b>它是你愿意承担的这笔亏损。系统会据此计算风险观察线和1R、2R参考目标；它们不是收益预测，仍由你确认和执行。</div>}
          <div className="modal-actions"><button type="button" onClick={onClose}>取消</button><button className="primary-button" type="submit" disabled={saving}>{saving ? "正在保存…" : "确认保存"}</button></div>
        </form>
      </section>
    </div>
  );
}

function ReviewModal({ cycle, onClose, onSaved }: {
  cycle: TradeCycle;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const firstInput = useRef<HTMLTextAreaElement>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const related = cycle.trades;
  const name = cycle.name;
  const buyReason = related.find((trade) => trade.side === "买入")?.reason ?? "";
  const sellReason = [...related].reverse().find((trade) => trade.side === "卖出")?.reason ?? "";

  useEffect(() => {
    firstInput.current?.focus();
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setMessage("");
    const data = new FormData(event.currentTarget);
    try {
      await jsonRequest("/api/reviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol: cycle.symbol,
          name,
          cycleEndTradeId: cycle.endTradeId,
          buyReason: data.get("buyReason"),
          sellReason: data.get("sellReason"),
          followedPlan: data.get("followedPlan") === "yes",
          lesson: data.get("lesson"),
        }),
      });
      await onSaved();
    } catch (saveError) {
      setMessage(saveError instanceof Error ? saveError.message : "复盘保存失败");
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal review-modal" role="dialog" aria-modal="true" aria-labelledby="review-title">
        <header><div><span className="eyebrow">只改进一件事</span><h2 id="review-title">复盘 {name}</h2></div><button onClick={onClose} aria-label="关闭">×</button></header>
        <form onSubmit={save}>
          <label>为什么买？<textarea ref={firstInput} name="buyReason" defaultValue={buyReason} required maxLength={300} /></label>
          <label>为什么卖？<textarea name="sellReason" defaultValue={sellReason} required maxLength={300} /></label>
          <fieldset><legend>有没有按计划执行？</legend><div className="reason-options"><label><input className="visually-hidden" type="radio" name="followedPlan" value="yes" required /><span>有，按计划</span></label><label><input className="visually-hidden" type="radio" name="followedPlan" value="no" required /><span>没有</span></label></div></fieldset>
          <label>下一次只改进哪一件事？<textarea name="lesson" required maxLength={500} placeholder="例如：触发止损后当天执行，不再向下移动止损线。" /></label>
          <div className="calculation-tip">程序按成交记录计算本次已实现盈亏：{money(cycle.realizedCents)}</div>
          {message && <p className="form-message" role="alert">{message}</p>}
          <div className="modal-actions"><button type="button" onClick={onClose}>取消</button><button className="primary-button" type="submit" disabled={saving}>{saving ? "正在保存…" : "保存复盘"}</button></div>
        </form>
      </section>
    </div>
  );
}

function PanelHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return <header className="panel-header"><div><h3>{title}</h3><p>{subtitle}</p></div></header>;
}

function CardTitle({ number, title, source }: { number: string; title: string; source: string }) {
  return <header className="card-title"><span>{number}</span><div><h3>{title}</h3><p>{source}</p></div></header>;
}
