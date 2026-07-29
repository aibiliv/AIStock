"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildTradeCycles, calculatePortfolio, localIsoDate, type Trade, type TradeCycle } from "../lib/domain";

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

type Analysis = {
  stock: { code: string; name: string; industry: string; marketSymbol: string };
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

type Status = {
  deepseekConfigured: boolean;
  aiProvider?: string;
  dataSource: string;
  reminderMode: string;
};

const navItems: Array<{ id: View; label: string; icon: string }> = [
  { id: "home", label: "首页", icon: "⌂" },
  { id: "watchlist", label: "关注", icon: "☆" },
  { id: "trades", label: "交易记录", icon: "↔" },
  { id: "settings", label: "设置", icon: "⚙" },
];

const buyReasons = ["看好公司业绩", "看好行业题材", "价格回调", "突破买入", "朋友或网络推荐", "担心错过", "冲动买入", "其他"];
const sellReasons = ["达到止盈目标", "触发止损", "买入逻辑失效", "害怕利润回吐", "临时需要资金", "看到其他股票", "不知道为什么卖", "其他"];

function money(cents: number) {
  return `¥${(cents / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function price(value: number) {
  return `¥${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "请求失败");
  return payload;
}

export function Dashboard() {
  const [view, setView] = useState<View>("home");
  const [query, setQuery] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [quotes, setQuotes] = useState<Record<string, Analysis>>({});
  const [trades, setTrades] = useState<Trade[]>([]);
  const [watchlist, setWatchlist] = useState<WatchItem[]>([]);
  const [alerts, setAlerts] = useState<AlertRule[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [tradeMode, setTradeMode] = useState<TradeMode | null>(null);
  const [reviewCycleEndTradeId, setReviewCycleEndTradeId] = useState<number | null>(null);
  const [settingsSection, setSettingsSection] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const notified = useRef(new Set<number>());

  const portfolio = useMemo(() => calculatePortfolio(trades), [trades]);
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
      const [tradeData, watchData, alertData, reviewData, statusData] = await Promise.all([
        jsonRequest<{ trades: Trade[] }>("/api/trades"),
        jsonRequest<{ items: WatchItem[] }>("/api/watchlist"),
        jsonRequest<{ alerts: AlertRule[] }>("/api/alerts"),
        jsonRequest<{ reviews: Review[] }>("/api/reviews"),
        jsonRequest<Status>("/api/status"),
      ]);
      setTrades(tradeData.trades);
      setWatchlist(watchData.items);
      setAlerts(alertData.alerts);
      setReviews(reviewData.reviews);
      setStatus(statusData);
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
    setAnalyzing(true);
    setError("");
    if (showResult) setAnalysis(null);
    try {
      const result = await jsonRequest<Analysis>("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: stockQuery, saveHistory: showResult }),
      });
      setQuotes((current) => ({ ...current, [result.stock.code]: result }));
      if (showResult) {
        setAnalysis(result);
        setQuery(result.stock.code);
        setView("home");
      }
      return result;
    } catch (analyzeError) {
      const message = analyzeError instanceof Error ? analyzeError.message : "股票分析失败";
      setError(message);
      flash(message);
      return null;
    } finally {
      setAnalyzing(false);
    }
  }, [flash]);

  useEffect(() => {
    const symbols = new Set([
      ...portfolio.positions.map((position) => position.symbol),
      ...alerts.filter((alert) => alert.enabled).map((alert) => alert.symbol),
    ]);
    const timer = window.setTimeout(() => {
      for (const symbol of symbols) {
        if (!quotes[symbol]) void fetchAnalysis(symbol, false);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [alerts, fetchAnalysis, portfolio.positions, quotes]);

  const checkAlerts = useCallback(() => {
    for (const alert of alerts) {
      if (!alert.enabled || alert.acknowledgedAt || notified.current.has(alert.id)) continue;
      const current = quotes[alert.symbol]?.quote.price;
      if (!current) continue;
      const target = alert.targetPriceCents / 100;
      const triggered = alert.type === "止损" ? current <= target : current >= target;
      if (!triggered) continue;
      notified.current.add(alert.id);
      const message = `${alert.name}已触发${alert.type}提醒：当前${price(current)}，目标${price(target)}`;
      flash(message);
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("我的股票助手", { body: message });
      }
    }
  }, [alerts, flash, quotes]);

  useEffect(() => {
    const firstCheck = window.setTimeout(checkAlerts, 0);
    const timer = window.setInterval(() => {
      for (const symbol of new Set(alerts.filter((item) => item.enabled).map((item) => item.symbol))) {
        void fetchAnalysis(symbol, false);
      }
    }, 300_000);
    return () => {
      window.clearTimeout(firstCheck);
      window.clearInterval(timer);
    };
  }, [alerts, checkAlerts, fetchAnalysis]);

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
        <button className="brand" onClick={() => setView("home")}>
          <span className="brand-mark">股</span>
          <span><strong>我的股票助手</strong><small>看懂 · 记录 · 复盘</small></span>
        </button>
        <nav aria-label="主导航">
          {navItems.map((item) => (
            <button key={item.id} className={view === item.id ? "nav-item active" : "nav-item"} onClick={() => setView(item.id)}>
              <span>{item.icon}</span>{item.label}
            </button>
          ))}
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
          <div><span className="mobile-brand">我的股票助手</span><h1>{navItems.find((item) => item.id === view)?.label}</h1></div>
          <div className="top-actions">
            <span className="privacy-pill">● 私有个人空间</span>
            <button className="primary-button" onClick={() => setTradeMode("buy")}>＋ 记录买入</button>
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
                onNavigate={setView}
                onReview={setReviewCycleEndTradeId}
                onAlertPlan={() => { setSettingsSection("alerts"); setView("settings"); }}
                onAcknowledge={(id) => void updateAlert(id)}
              />
            )}
            {view === "watchlist" && (
              <Watchlist
                items={watchlist}
                quotes={quotes}
                onSearch={() => setView("home")}
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
                alerts={alerts}
                section={settingsSection}
                onSection={setSettingsSection}
                onDisable={(id) => void updateAlert(id, "disable")}
                onNotifications={() => void requestNotifications()}
              />
            )}
          </>
        )}
      </main>

      <nav className="mobile-nav" aria-label="移动端导航">
        {navItems.map((item) => (
          <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}>
            <span>{item.icon}</span>{item.label}
          </button>
        ))}
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
      {toast && <div className="toast" role="status" aria-live="polite"><span>✓</span>{toast}</div>}
    </div>
  );
}

function Home({
  query, setQuery, analysis, analyzing, portfolio, quotes, alerts, pendingReviews,
  trades, reviews, watched, onAnalyze, onBuy, onSell, onWatch, onNavigate,
  onReview, onAlertPlan, onAcknowledge,
}: {
  query: string;
  setQuery: (value: string) => void;
  analysis: Analysis | null;
  analyzing: boolean;
  portfolio: ReturnType<typeof calculatePortfolio>;
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
        <h2>{analysis ? "继续查一只股票" : "输入股票，先把它看懂。"}</h2>
        {!analysis && <p>公开数据提供事实，AI或自动规则负责解释，你负责最后的决定。</p>}
        <form className="stock-search" onSubmit={onAnalyze}>
          <span className="search-icon">⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例如 600519、贵州茅台" aria-label="股票代码或名称" />
          <button type="submit" disabled={analyzing}>{analyzing ? "正在获取数据…" : "开始分析"}</button>
        </form>
        <div className="search-meta"><span>无需股票数据账号</span><i /><span>结果标明数据时间</span><i /><span>不提供买卖建议</span></div>
      </section>

      {analysis ? (
        <AnalysisView
          analysis={analysis}
          watched={watched}
          canSell={portfolio.positions.some((position) => position.symbol === analysis.stock.code)}
          onWatch={onWatch}
          onBuy={onBuy}
          onSell={onSell}
        />
      ) : (
        <>
          <section className="quick-title"><div><span className="eyebrow">今天只处理重要的事</span><h3>我的持仓</h3></div><button onClick={() => onNavigate("trades")}>查看交易记录 →</button></section>
          {portfolio.positions.length ? (
            <div className="holding-grid">
              {portfolio.positions.map((position) => {
                const quote = quotes[position.symbol]?.quote.price;
                const profit = quote ? (quote * 100 - position.averageCostCents) * position.quantity : 0;
                const rate = quote ? ((quote * 100 / position.averageCostCents) - 1) * 100 : null;
                const stop = activeAlerts.find((item) => item.symbol === position.symbol && item.type === "止损");
                return (
                  <article className="holding-card" key={position.symbol}>
                    <div className="holding-top">
                      <span className="stock-avatar">{position.name.slice(0, 1)}</span>
                      <div><h4>{position.name}<small>{position.symbol}</small></h4><p>{position.quantity}股 · 成本{money(position.averageCostCents)}</p></div>
                      <strong className={(rate ?? 0) >= 0 ? "up" : "down"}>{rate === null ? "行情更新中" : `${rate >= 0 ? "+" : ""}${rate.toFixed(2)}%`}</strong>
                    </div>
                    <div className="risk-line"><span>按当前参考价计算</span><b>{quote ? money(profit) : "—"}</b></div>
                    <div className={`holding-status ${stop ? "amber" : ""}`}><i />{stop ? `止损提醒 ${money(stop.targetPriceCents)}` : "尚未设置止损提醒"}</div>
                  </article>
                );
              })}
            </div>
          ) : <div className="empty-state">还没有持仓。先查一只股票，或记录你的第一笔买入。</div>}

          <div className="summary-strip home-summary">
            <div><span>已实现盈亏</span><strong className={portfolio.realizedCents >= 0 ? "up" : "down"}>{money(portfolio.realizedCents)}</strong></div>
            <div><span>完整交易胜率</span><strong>{completedCycles.length ? `${winRate}%` : "—"}</strong></div>
            <div><span>按计划复盘</span><strong>{reviews.length ? `${planRate}%` : "—"}</strong></div>
            <div><span>最近改进规则</span><strong className="summary-lesson">{reviews[0]?.lesson ?? "暂无"}</strong></div>
          </div>

          <div className="home-grid">
            <section className="panel reminder-panel">
              <PanelHeader title="价格提醒" subtitle="页面打开期间每5分钟检查" />
              {activeAlerts.slice(0, 3).map((alert) => (
                <div className="reminder" key={alert.id}>
                  <span className={`reminder-icon ${alert.type === "止损" ? "red" : "amber"}`}>!</span>
                  <div><b>{alert.name} · {alert.type}</b><p>目标价 {money(alert.targetPriceCents)} · 免费行情可能延迟</p></div>
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

function AnalysisView({ analysis, watched, canSell, onWatch, onBuy, onSell }: {
  analysis: Analysis;
  watched: boolean;
  canSell: boolean;
  onWatch: () => void;
  onBuy: () => void;
  onSell: () => void;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const { stock, quote, financials, explanation } = analysis;
  const quoteDate = quote.marketTime ? new Date(quote.marketTime).toLocaleString("zh-CN") : "数据源未提供";

  return (
    <div className="analysis-page">
      <section className="stock-summary panel">
        <div className="stock-identity">
          <span className="stock-avatar large">{stock.name.slice(0, 1)}</span>
          <div><span className="demo-label">{analysis.mode === "deepseek" ? "AI解释" : "自动解释"}</span><h2>{stock.name} <small>{stock.code}</small></h2><p>{stock.industry}</p></div>
        </div>
        <div className="price-block">
          <strong>{price(quote.price)}</strong>
          <span className={quote.changePercent >= 0 ? "up" : "down"}>{quote.changePercent >= 0 ? "+" : ""}{quote.changePercent.toFixed(2)}%</span>
          <small>行情时间 {quoteDate}</small>
        </div>
        <div className="summary-actions">
          <button className={watched ? "soft-button active" : "soft-button"} onClick={onWatch}>{watched ? "✓ 已关注" : "☆ 加入关注"}</button>
          <button className="primary-button" onClick={onBuy}>记录买入</button>
        </div>
      </section>

      <section className="ai-conclusion">
        <span className="ai-mark">{analysis.mode === "deepseek" ? "AI" : "算"}</span>
        <div><span>一句话看懂</span><h3>{explanation.summary}</h3><p>只基于页面所列公开数据整理，不构成投资建议。</p></div>
      </section>

      <MarketChart analysis={analysis} />

      <div className="analysis-grid">
        <section className="panel analysis-card">
          <CardTitle number="01" title="公司与行业" source="通俗解释" />
          <div className="plain-points">
            {explanation.company.map((item, index) => <p key={item}><b>{["是什么", "数据代码", "还要核验"][index] ?? "信息"}</b><span>{item}</span></p>)}
          </div>
        </section>

        <section className="panel analysis-card">
          <CardTitle number="02" title="财务体检" source="公开财务接口" />
          <div className="metric-row">
            <Metric label="营收变化" value={financials.revenueGrowth} suffix="%" />
            <Metric label="利润变化" value={financials.profitGrowth} suffix="%" />
            <Metric label="负债率" value={financials.debtRatio} suffix="%" />
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
        </section>

        <section className="panel analysis-card">
          <CardTitle number="03" title="价格位置" source="程序计算" />
          <div className="metric-row">
            <Metric label="20日均线" value={quote.ma20} moneyValue />
            <Metric label="近60日高点" value={quote.recentHigh} moneyValue />
            <Metric label="平均日波动" value={quote.volatility} suffix="%" />
          </div>
          <p className="card-note">价格位于20日均线{quote.price >= quote.ma20 ? "上方" : "下方"}。价格位置只能辅助制定计划，不能单独决定买卖。</p>
        </section>

        <section className="panel analysis-card">
          <CardTitle number="04" title="题材信息" source="候选信息 · 需核验" />
          <div className="theme-list">
            {explanation.themes.map((theme) => <div key={theme.name}><b>{theme.name}</b><span className="confidence high">{theme.confidence}</span><p>{theme.reason}</p></div>)}
          </div>
          <p className="source-warning">题材不等于业绩事实，请结合公司公告核验。</p>
        </section>

        <section className="panel analysis-card risks-card">
          <CardTitle number="05" title="主要风险" source="按数据可见范围整理" />
          <ol>{explanation.risks.map((risk, index) => <li key={risk}><span>{index + 1}</span><div><p>{risk}</p></div></li>)}</ol>
          {explanation.missingInformation.length > 0 && <p className="source-warning">仍缺少：{explanation.missingInformation.join("、")}</p>}
        </section>

        <section className="panel analysis-card price-plan-card">
          <CardTitle number="06" title="价格参考" source="参考情景，不是买卖建议" />
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
        <div><button className="soft-button" onClick={onWatch}>{watched ? "✓ 已关注" : "☆ 加入关注"}</button>{canSell && <button className="soft-button" onClick={onSell}>记录卖出</button>}<button className="primary-button" onClick={onBuy}>我已买入</button></div>
      </section>
    </div>
  );
}

function MarketChart({ analysis }: { analysis: Analysis }) {
  const rows = analysis.history.slice(-60);
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

  return (
    <section className="panel market-chart-card">
      <div className="chart-heading">
        <div><span className="eyebrow">近60个交易日</span><h3>K线与成交量</h3></div>
        <div className="chart-legend"><span className="ma5">5日</span><span className="ma20">20日</span><span className="ma60">60日</span></div>
      </div>
      <svg className="market-chart" viewBox={`0 0 ${width} 280`} role="img" aria-label={`${analysis.stock.name}近60个交易日K线、成交量和均线`}>
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
      </svg>
      <div className="chart-summary">
        <span>5日均线 <b>{price(analysis.quote.ma5)}</b></span>
        <span>20日均线 <b>{price(analysis.quote.ma20)}</b></span>
        <span>60日均线 <b>{price(analysis.quote.ma60)}</b></span>
        <span>最大成交量日 <b>{volumeHighlight?.date ?? "暂无"}</b></span>
      </div>
    </section>
  );
}

type HistoryReport = {
  id: number;
  priceCents: number;
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
        const change = ((currentPrice * 100 / report.priceCents) - 1) * 100;
        return (
          <article className="history-item" key={report.id}>
            <div><b>{new Date(report.createdAt).toLocaleString("zh-CN")}</b><span>{report.mode === "deepseek" ? "AI" : "自动解释"} · 当时{money(report.priceCents)} · 至今<span className={change >= 0 ? "up" : "down"}>{change >= 0 ? "+" : ""}{change.toFixed(2)}%</span></span></div>
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

function Metric({ label, value, suffix = "", moneyValue = false }: { label: string; value: number | null; suffix?: string; moneyValue?: boolean }) {
  const content = value === null ? "暂无" : moneyValue ? price(value) : `${value >= 0 && suffix === "%" ? "+" : ""}${value.toFixed(1)}${suffix}`;
  return <div><span>{label}</span><strong className={value !== null && value < 0 ? "down" : "neutral"}>{content}</strong><small>{value === null ? "数据不足" : "最新可用数据"}</small></div>;
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
      <section className="page-intro"><div><span className="eyebrow">先研究，再决定</span><h2>我的关注</h2><p>每只股票都保留一个明确的等待条件。</p></div><button className="primary-button" onClick={onSearch}>＋ 查找股票</button></section>
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
      <section className="page-intro"><div><span className="eyebrow">真实记录，才能真实复盘</span><h2>交易记录</h2><p>只有完全清仓才会生成待复盘任务；部分卖出仍属于同一持仓周期。</p></div><div className="intro-actions"><button className="soft-button" onClick={onSell} disabled={!portfolio.positions.length}>记录卖出</button><button className="primary-button" onClick={onBuy}>＋ 记录买入</button></div></section>
      <div className="summary-strip">
        <div><span>交易记录</span><strong>{trades.length}</strong></div>
        <div><span>当前持仓</span><strong>{portfolio.positions.length}</strong></div>
        <div><span>已实现盈亏</span><strong className={portfolio.realizedCents >= 0 ? "up" : "down"}>{money(portfolio.realizedCents)}</strong></div>
        <div><span>完整交易胜率</span><strong>{completedCycles.length ? `${Math.round(winningCycles / completedCycles.length * 100)}%` : "—"}</strong></div>
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
                <span><b className={`side ${trade.side === "买入" ? "buy" : "sell"}`}>{trade.side}</b><small>{money(trade.priceCents)}</small></span>
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

function Settings({ status, alerts, section, onSection, onDisable, onNotifications }: {
  status: Status | null;
  alerts: AlertRule[];
  section: string | null;
  onSection: (section: string | null) => void;
  onDisable: (id: number) => void;
  onNotifications: () => void;
}) {
  const notificationState = typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported";
  const cards = [
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
            <div className="setting-copy"><h3>{card.title}</h3><p>{card.text}</p><span className="connected">● {card.state}</span></div>
            <button className="text-button" onClick={() => onSection(section === card.id ? null : card.id)}>{section === card.id ? "收起" : "查看"}</button>
          </article>
        ))}
      </div>
      {section === "ai" && <section className="panel settings-detail"><h3>AI连接状态</h3><p>{status?.deepseekConfigured ? "AI API密钥只在服务端读取，浏览器无法看到。" : "没有AI密钥时，系统不会假装调用AI，而是明确显示“自动解释”。"}</p></section>}
      {section === "data" && <section className="panel settings-detail"><h3>数据原则</h3><p>行情来自公开接口，可能延迟或暂时不可用。每次分析都记录来源、行情时间和获取时间；财务数据缺失时显示“暂无”，不会补数字。</p></section>}
      {section === "alerts" && (
        <section className="panel settings-detail">
          <div className="settings-detail-head"><div><h3>提醒管理</h3><p>浏览器权限：{notificationState}</p></div><button className="primary-button" onClick={onNotifications}>申请浏览器通知</button></div>
          {alerts.length ? alerts.map((alert) => <div className="alert-row" key={alert.id}><span><b>{alert.name} · {alert.type}</b><small>{money(alert.targetPriceCents)} · {alert.enabled ? "启用" : "已停用"}</small></span>{alert.enabled && <button className="danger-link" onClick={() => onDisable(alert.id)}>停用</button>}</div>) : <p>暂无提醒规则。</p>}
        </section>
      )}
      {section === "privacy" && <section className="panel settings-detail"><h3>导出个人数据</h3><p>备份包含交易、关注、提醒与复盘，不包含任何API密钥。</p><a className="primary-button download-link" href="/api/export">下载JSON备份</a></section>}
      <section className="panel boundary-card">
        <span>产品边界</span>
        <div><p>✓ 不自动交易</p><p>✓ 不荐股</p><p>✓ 不承诺提醒必达</p><p>✓ 数据缺失会明说</p><p>✓ 最终决定由你作出</p><p>✓ 重要止损在券商App重复设置</p></div>
      </section>
    </div>
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
            <label>{mode === "buy" ? "买入" : "卖出"}价格<input name="price" type="number" min="0.01" step="0.01" required /></label>
            <label>数量（股）<input name="quantity" type="number" min="1" step="1" required /></label>
            <label>交易日期<input name="tradeDate" type="date" defaultValue={localIsoDate()} max={localIsoDate()} required /></label>
            <label>总费用（可选）<input name="fee" type="number" min="0" step="0.01" defaultValue="0" /></label>
            {mode === "buy" && <label>最多接受亏损（元）<input name="maxLoss" type="number" min="0" step="0.01" placeholder="用于计算止损和1R/2R提醒" /></label>}
          </div>
          <fieldset><legend>为什么{mode === "buy" ? "买" : "卖"}？</legend><div className="reason-options">{(mode === "buy" ? buyReasons : sellReasons).map((reason) => <label key={reason}><input className="visually-hidden" type="radio" name="reason" value={reason} required /><span>{reason}</span></label>)}</div></fieldset>
          {mode === "buy" && <div className="calculation-tip">填写最大亏损后，系统会按“买入价 − 最大亏损 ÷ 数量”创建止损，并生成1R、2R止盈提醒。由你确认和执行。</div>}
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
  const result = cycle.realizedCents / 100;

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
          <div className="calculation-tip">程序按成交记录计算本次已实现盈亏：{price(result)}</div>
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
