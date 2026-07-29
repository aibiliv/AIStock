"use client";

import { FormEvent, useState } from "react";

type View = "home" | "watchlist" | "trades" | "settings";
type Modal = "buy" | "sell" | null;

type Trade = {
  id: number;
  stock: string;
  code: string;
  side: "买入" | "卖出";
  price: number;
  quantity: number;
  date: string;
  reason: string;
};

const navItems: { id: View; label: string; icon: string }[] = [
  { id: "home", label: "首页", icon: "⌂" },
  { id: "watchlist", label: "关注", icon: "☆" },
  { id: "trades", label: "交易记录", icon: "↕" },
  { id: "settings", label: "设置", icon: "⚙" },
];

const holdings = [
  { name: "贵州茅台", code: "600519", price: "1,512.80", profit: "+3.20%", stopDistance: "4.10%", status: "接近第一止盈", tone: "amber" },
  { name: "宁德时代", code: "300750", price: "284.63", profit: "-1.50%", stopDistance: "2.00%", status: "注意止损距离", tone: "red" },
];

const initialTrades: Trade[] = [
  { id: 1, stock: "贵州茅台", code: "600519", side: "买入", price: 1466, quantity: 100, date: "2026-07-15", reason: "看好公司业绩" },
  { id: 2, stock: "宁德时代", code: "300750", side: "买入", price: 288.96, quantity: 100, date: "2026-07-22", reason: "价格回调" },
  { id: 3, stock: "比亚迪", code: "002594", side: "卖出", price: 118.4, quantity: 200, date: "2026-07-18", reason: "达到止盈目标" },
];

const watchlist = [
  { name: "北方华创", code: "002371", industry: "半导体设备", price: "438.20", change: "+1.35%", note: "突破前高且放量后再考虑", state: "等待条件" },
  { name: "胜宏科技", code: "300476", industry: "PCB · AI算力", price: "176.64", change: "+4.82%", note: "当日涨幅超过5%不追高", state: "研究中" },
  { name: "紫金矿业", code: "601899", industry: "黄金 · 有色", price: "21.76", change: "-0.62%", note: "等板块与金价形成共振", state: "一般关注" },
];

const financials = [
  { name: "营收", state: "良好", tone: "green", detail: "最近一年保持增长，主营业务仍较稳定。" },
  { name: "净利润", state: "留意", tone: "amber", detail: "利润仍在增长，但增速比前期有所下降。" },
  { name: "现金流", state: "良好", tone: "green", detail: "经营活动现金流能够覆盖同期净利润。" },
  { name: "负债", state: "良好", tone: "green", detail: "有息负债压力不高，短期偿债风险较低。" },
  { name: "应收账款", state: "留意", tone: "amber", detail: "需要继续观察其增长是否快于营业收入。" },
  { name: "商誉", state: "正常", tone: "green", detail: "暂未发现明显的大额商誉减值压力。" },
];

export function Dashboard() {
  const [view, setView] = useState<View>("home");
  const [query, setQuery] = useState("");
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [trades, setTrades] = useState(initialTrades);
  const [toast, setToast] = useState("");
  const [isWatched, setIsWatched] = useState(false);

  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  function analyzeStock(event?: FormEvent) {
    event?.preventDefault();
    if (!query.trim()) {
      flash("请输入股票代码或名称");
      return;
    }
    setAnalyzing(true);
    window.setTimeout(() => {
      setAnalyzing(false);
      setShowAnalysis(true);
    }, 850);
  }

  async function saveTrade(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const side = modal === "sell" ? "卖出" : "买入";
    const trade: Trade = {
      id: Date.now(),
      stock: String(data.get("stock")),
      code: String(data.get("code")),
      side,
      price: Number(data.get("price")),
      quantity: Number(data.get("quantity")),
      date: String(data.get("date")),
      reason: String(data.get("reason")),
    };
    setTrades((current) => [trade, ...current]);
    setModal(null);
    flash(`${trade.stock}的${side}记录已保存`);
    try {
      await fetch("/api/trades", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol: trade.code,
          name: trade.stock,
          side: trade.side,
          price: trade.price,
          quantity: trade.quantity,
          reason: trade.reason,
          plan: side === "买入" ? "待确认止盈止损提醒" : "等待完成复盘",
        }),
      });
    } catch {
      // The interface remains usable if the cloud database is temporarily unavailable.
    }
  }

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
          <p>AI只负责解释信息，不替你决定买卖。重要止损请同时在券商 App 设置。</p>
        </div>
        <div className="source-status"><i /><span><b>演示模式</b><small>尚未配置真实数据</small></span></div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div><span className="mobile-brand">我的股票助手</span><h1>{navItems.find((item) => item.id === view)?.label}</h1></div>
          <div className="top-actions">
            <span className="privacy-pill">● 私人空间</span>
            <button className="primary-button" onClick={() => setModal("buy")}>＋ 记录买入</button>
          </div>
        </header>

        {view === "home" && (
          <Home
            query={query}
            setQuery={setQuery}
            showAnalysis={showAnalysis}
            analyzing={analyzing}
            onAnalyze={analyzeStock}
            onBuy={() => setModal("buy")}
            onSell={() => setModal("sell")}
            onWatch={() => {
              setIsWatched(true);
              flash("贵州茅台已加入关注");
            }}
            isWatched={isWatched}
            onNavigate={setView}
          />
        )}
        {view === "watchlist" && <Watchlist onSearch={() => setView("home")} />}
        {view === "trades" && <Trades trades={trades} onBuy={() => setModal("buy")} onSell={() => setModal("sell")} />}
        {view === "settings" && <Settings />}
      </main>

      <nav className="mobile-nav" aria-label="移动端导航">
        {navItems.map((item) => (
          <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}>
            <span>{item.icon}</span>{item.label}
          </button>
        ))}
      </nav>

      {modal && <TradeModal mode={modal} onClose={() => setModal(null)} onSubmit={saveTrade} />}
      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </div>
  );
}

function Home({
  query,
  setQuery,
  showAnalysis,
  analyzing,
  onAnalyze,
  onBuy,
  onSell,
  onWatch,
  isWatched,
  onNavigate,
}: {
  query: string;
  setQuery: (value: string) => void;
  showAnalysis: boolean;
  analyzing: boolean;
  onAnalyze: (event?: FormEvent) => void;
  onBuy: () => void;
  onSell: () => void;
  onWatch: () => void;
  isWatched: boolean;
  onNavigate: (view: View) => void;
}) {
  return (
    <div className="page-content">
      <section className={showAnalysis ? "search-hero compact" : "search-hero"}>
        <span className="eyebrow">A股新手也能看懂</span>
        <h2>{showAnalysis ? "继续查一只股票" : "输入股票，先把它看懂。"}</h2>
        {!showAnalysis && <p>公开数据负责提供事实，AI负责说人话，你负责最后的决定。</p>}
        <form className="stock-search" onSubmit={onAnalyze}>
          <span className="search-icon">⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入股票代码或名称，例如 600519、贵州茅台" aria-label="股票代码或名称" />
          <button type="submit" disabled={analyzing}>{analyzing ? "正在整理…" : "开始分析"}</button>
        </form>
        <div className="search-meta"><span>无需股票数据账号</span><i /> <span>分析前会显示数据日期</span><i /> <span>不提供买卖建议</span></div>
        {!showAnalysis && <div className="hero-orbit" aria-hidden="true"><span>财务</span><span>业绩</span><span>题材</span><span>风险</span></div>}
      </section>

      {!showAnalysis ? (
        <>
          <section className="quick-title"><div><span className="eyebrow">今天只处理重要的事</span><h3>我的持仓</h3></div><button onClick={() => onNavigate("trades")}>查看交易记录 →</button></section>
          <div className="holding-grid">
            {holdings.map((stock) => (
              <article className="holding-card" key={stock.code}>
                <div className="holding-top">
                  <span className="stock-avatar">{stock.name.slice(0, 1)}</span>
                  <div><h4>{stock.name}<small>{stock.code}</small></h4><p>参考价 ¥{stock.price}</p></div>
                  <strong className={stock.profit.startsWith("+") ? "up" : "down"}>{stock.profit}</strong>
                </div>
                <div className="risk-line"><span>距离你的止损价</span><b>{stock.stopDistance}</b></div>
                <div className={`holding-status ${stock.tone}`}><i />{stock.status}</div>
              </article>
            ))}
          </div>

          <div className="home-grid">
            <section className="panel reminder-panel">
              <PanelHeader title="今日提醒" subtitle="只有需要你行动的内容" />
              <div className="reminder"><span className="reminder-icon amber">!</span><div><b>贵州茅台接近第一止盈参考</b><p>距离你设置的 ¥1,528.00 还有 1.0%</p></div><button>查看计划</button></div>
              <div className="reminder"><span className="reminder-icon red">!</span><div><b>宁德时代距离止损较近</b><p>免费行情可能延迟，请同时检查券商 App</p></div><button>我知道了</button></div>
            </section>
            <section className="panel review-panel">
              <PanelHeader title="待复盘" subtitle="卖出后只回答三个问题" />
              <div className="review-item">
                <span className="stock-avatar pale">比</span>
                <div><b>比亚迪 · 已清仓</b><p>盈利 ¥1,680 · 收益率 7.63%</p></div>
                <button onClick={() => onNavigate("trades")}>开始复盘 →</button>
              </div>
              <div className="simple-rule"><span>复盘不考试</span><p>只看：为什么买、为什么卖、有没有按计划。</p></div>
            </section>
          </div>
        </>
      ) : (
        <Analysis onBuy={onBuy} onSell={onSell} onWatch={onWatch} isWatched={isWatched} />
      )}
    </div>
  );
}

function Analysis({ onBuy, onSell, onWatch, isWatched }: { onBuy: () => void; onSell: () => void; onWatch: () => void; isWatched: boolean }) {
  return (
    <div className="analysis-page">
      <section className="stock-summary panel">
        <div className="stock-identity">
          <span className="stock-avatar large">茅</span>
          <div><span className="demo-label">示例数据</span><h2>贵州茅台 <small>600519 · 沪市</small></h2><p>白酒 · 食品饮料</p></div>
        </div>
        <div className="price-block"><strong>¥1,512.80</strong><span className="up">+18.80 · +1.26%</span><small>数据日期 2026-07-28 收盘</small></div>
        <div className="summary-actions">
          <button className={isWatched ? "soft-button active" : "soft-button"} onClick={onWatch}>{isWatched ? "★ 已关注" : "☆ 加入关注"}</button>
          <button className="primary-button" onClick={onBuy}>记录买入</button>
        </div>
      </section>

      <section className="ai-conclusion">
        <span className="ai-mark">AI</span>
        <div><span>一句话看懂</span><h3>公司盈利能力仍然较强，但增速已不像过去那么快；对新手来说，更需要关注估值和消费需求变化。</h3><p>以下内容根据页面中的示例数据整理，不构成投资建议。</p></div>
      </section>

      <div className="analysis-grid">
        <section className="panel analysis-card company-card">
          <CardTitle number="01" title="公司是做什么的" source="AI 通俗解释" />
          <div className="plain-points">
            <p><b>卖什么</b><span>核心产品是贵州茅台酒，同时经营系列酒。</span></p>
            <p><b>卖给谁</b><span>通过经销与直营渠道，面向个人、企业和礼赠消费。</span></p>
            <p><b>怎么赚钱</b><span>依靠品牌溢价、较高毛利率和稀缺产能获得利润。</span></p>
          </div>
        </section>

        <section className="panel analysis-card finance-card">
          <CardTitle number="02" title="财务体检" source="基于近 4 期财务数据" />
          <div className="financial-list">
            {financials.map((item) => <div key={item.name}><span>{item.name}</span><i className={item.tone}>{item.state}</i><p>{item.detail}</p></div>)}
          </div>
          <button className="text-button">展开查看原始数字 ↓</button>
        </section>

        <section className="panel analysis-card performance-card">
          <CardTitle number="03" title="业绩变化" source="程序计算 · AI 解释" />
          <div className="metric-row"><div><span>营业收入</span><strong>+15.7%</strong><small>最近一期同比</small></div><div><span>归母净利润</span><strong>+14.8%</strong><small>最近一期同比</small></div><div><span>经营现金流</span><strong className="neutral">稳定</strong><small>覆盖净利润</small></div></div>
          <div className="trend-chart" aria-label="近四期营收与利润趋势"><i style={{ height: "55%" }} /><i style={{ height: "68%" }} /><i style={{ height: "76%" }} /><i style={{ height: "88%" }} /></div>
          <p className="card-note">怎么看：业绩仍在增长，但需要观察增速是否继续放缓，以及直营渠道能否保持效率。</p>
        </section>

        <section className="panel analysis-card themes-card">
          <CardTitle number="04" title="题材信息" source="第三方候选 · 需要核验" />
          <div className="theme-list">
            <div><b>高端白酒</b><span className="confidence high">关联较强</span><p>来自公司主营业务，属于长期行业标签。</p></div>
            <div><b>大消费</b><span className="confidence">关联一般</span><p>消费复苏预期可能影响市场关注度。</p></div>
            <div><b>国企改革</b><span className="confidence">待核验</span><p>属于市场概念，需要结合公司公告确认。</p></div>
          </div>
          <p className="source-warning">题材不等于公司业绩，AI不会把市场概念自动认定为事实。</p>
        </section>

        <section className="panel analysis-card risks-card">
          <CardTitle number="05" title="主要风险" source="按重要程度排序" />
          <ol>
            <li><span>1</span><div><b>需求与价格风险</b><p>高端白酒需求如果持续走弱，可能影响收入与渠道库存。</p></div></li>
            <li><span>2</span><div><b>增长速度放缓</b><p>高基数下维持过去的高速增长会越来越困难。</p></div></li>
            <li><span>3</span><div><b>估值波动</b><p>市场预期变化可能让股价先于业绩出现较大波动。</p></div></li>
          </ol>
        </section>

        <section className="panel analysis-card price-plan-card">
          <CardTitle number="06" title="价格参考" source="参考情景，不是买卖建议" />
          <div className="price-scenarios">
            <div className="risk"><span>风险观察线</span><strong>¥1,455</strong><p>接近近期低点，跌破后需要重新检查原判断。</p></div>
            <div><span>第一目标参考</span><strong>¥1,560</strong><p>接近前期密集成交区域，可考虑保护利润。</p></div>
            <div><span>乐观情景</span><strong>¥1,625</strong><p>只有趋势保持较强时才继续观察。</p></div>
          </div>
          <div className="price-disclaimer">价格不能单独决定买卖。请先填写买入价、数量和最多能接受亏损多少钱。</div>
        </section>
      </div>

      <section className="decision-bar">
        <div><span className="eyebrow">现在由你决定</span><h3>这只股票下一步怎么处理？</h3></div>
        <div><button className="soft-button" onClick={onWatch}>☆ {isWatched ? "已加入关注" : "加入关注"}</button><button className="soft-button" onClick={onSell}>记录卖出</button><button className="primary-button" onClick={onBuy}>我已买入</button></div>
      </section>
    </div>
  );
}

function Watchlist({ onSearch }: { onSearch: () => void }) {
  return (
    <div className="page-content inner-page">
      <section className="page-intro"><div><span className="eyebrow">先研究，再决定</span><h2>我的关注</h2><p>这里不是股票购物车。每只股票都要写下“什么条件出现才行动”。</p></div><button className="primary-button" onClick={onSearch}>＋ 查找股票</button></section>
      <div className="watch-cards">
        {watchlist.map((stock) => (
          <article className="panel watch-card" key={stock.code}>
            <div className="watch-card-top"><span className="stock-avatar">{stock.name.slice(0, 1)}</span><span className="watch-state">{stock.state}</span></div>
            <h3>{stock.name}<small>{stock.code}</small></h3><p>{stock.industry}</p>
            <div className="watch-price"><strong>¥{stock.price}</strong><span className={stock.change.startsWith("+") ? "up" : "down"}>{stock.change}</span></div>
            <div className="watch-note"><span>我的观察条件</span><p>{stock.note}</p></div>
            <button className="text-button">查看分析 →</button>
          </article>
        ))}
      </div>
      <section className="empty-tip"><span>小建议</span><p>关注列表控制在 10 只以内，会比收藏几十只股票更容易真正看懂。</p></section>
    </div>
  );
}

function Trades({ trades, onBuy, onSell }: { trades: Trade[]; onBuy: () => void; onSell: () => void }) {
  return (
    <div className="page-content inner-page">
      <section className="page-intro"><div><span className="eyebrow">每笔只需约 30 秒</span><h2>交易记录</h2><p>记录真实买卖和当时原因，系统自动计算，卖出后再做简短复盘。</p></div><div className="intro-actions"><button className="soft-button" onClick={onSell}>记录卖出</button><button className="primary-button" onClick={onBuy}>＋ 记录买入</button></div></section>
      <div className="summary-strip">
        <div><span>累计盈亏</span><strong className="up">+¥3,420</strong></div>
        <div><span>交易胜率</span><strong>60%</strong></div>
        <div><span>按计划操作</span><strong>75%</strong></div>
        <div><span>最常见问题</span><strong className="warning-text">过早止盈</strong></div>
      </div>
      <section className="panel trade-list">
        <div className="trade-head"><span>日期 / 操作</span><span>股票</span><span>成交信息</span><span>当时原因</span><span>状态</span></div>
        {trades.map((trade, index) => (
          <article className="trade-row" key={trade.id}>
            <span><b className={trade.side === "买入" ? "side buy" : "side sell"}>{trade.side}</b><small>{trade.date}</small></span>
            <span><b>{trade.stock}</b><small>{trade.code}</small></span>
            <span><b>¥{trade.price.toFixed(2)}</b><small>{trade.quantity} 股</small></span>
            <span className="trade-reason">{trade.reason}</span>
            <span>{index === 2 ? <button className="review-button">待复盘</button> : <i className="holding-label">持仓中</i>}</span>
          </article>
        ))}
      </section>
    </div>
  );
}

function Settings() {
  return (
    <div className="page-content inner-page settings-page">
      <section className="page-intro"><div><span className="eyebrow">保持简单，也要保护数据</span><h2>设置</h2><p>真实数据与 AI 接口都只在服务端处理，不会把密钥放进浏览器。</p></div></section>
      <div className="settings-grid">
        <section className="panel setting-card">
          <div className="setting-icon ai">AI</div>
          <div className="setting-copy"><h3>DeepSeek 分析</h3><p>把财务、业绩和风险翻译成通俗语言。密钥必须通过服务端安全环境配置。</p><span className="not-connected">● 尚未连接</span></div>
          <button className="soft-button">查看配置说明</button>
        </section>
        <section className="panel setting-card">
          <div className="setting-icon data">数</div>
          <div className="setting-copy"><h3>A股公开数据</h3><p>计划使用无需账号的公开数据服务，并保存最后更新时间；获取失败时不冒充最新数据。</p><span className="demo-status">● 当前为演示数据</span></div>
          <button className="soft-button">数据原则</button>
        </section>
        <section className="panel setting-card">
          <div className="setting-icon alert">铃</div>
          <div className="setting-copy"><h3>价格提醒</h3><p>网站提醒仅作参考。重要止损必须同时在券商 App 中设置，避免网络或数据延迟。</p><span className="connected">● 浏览器提醒已开启</span></div>
          <button className="soft-button">管理提醒</button>
        </section>
        <section className="panel setting-card">
          <div className="setting-icon private">锁</div>
          <div className="setting-copy"><h3>隐私与备份</h3><p>你的交易数据默认私有。建议定期导出备份，不上传券商账号和密码。</p><span className="connected">● 私有访问</span></div>
          <button className="soft-button">导出数据</button>
        </section>
      </div>
      <section className="panel boundary-card"><span>产品边界</span><div><p>✓ 帮你看懂事实</p><p>✓ 帮你记录和复盘</p><p>✓ 按你确认的价格提醒</p><p>× 不荐股</p><p>× 不自动交易</p><p>× 不保证提醒必达</p></div></section>
    </div>
  );
}

function CardTitle({ number, title, source }: { number: string; title: string; source: string }) {
  return <header className="card-title"><span>{number}</span><div><h3>{title}</h3><p>{source}</p></div></header>;
}

function PanelHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return <header className="panel-header"><div><h3>{title}</h3><p>{subtitle}</p></div></header>;
}

function TradeModal({ mode, onClose, onSubmit }: { mode: Exclude<Modal, null>; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const isBuy = mode === "buy";
  const reasons = isBuy
    ? ["看好公司业绩", "看好行业题材", "价格回调", "突破买入", "朋友或网络推荐", "担心错过", "冲动买入", "其他"]
    : ["达到止盈目标", "触发止损", "买入逻辑失效", "害怕利润回吐", "临时需要资金", "看到其他股票", "不知道为什么卖", "其他"];
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header><div><span className="eyebrow">{isBuy ? "只填五项" : "卖出后会生成复盘"}</span><h2 id="modal-title">记录{isBuy ? "买入" : "卖出"}</h2></div><button onClick={onClose} aria-label="关闭">×</button></header>
        <form onSubmit={onSubmit}>
          <div className="form-grid">
            <label>股票名称<input name="stock" defaultValue="贵州茅台" required /></label>
            <label>股票代码<input name="code" defaultValue="600519" required /></label>
            <label>{isBuy ? "买入" : "卖出"}价格<input name="price" type="number" step="0.01" placeholder="0.00" required /></label>
            <label>{isBuy ? "买入" : "卖出"}数量<input name="quantity" type="number" step="100" placeholder="100" required /></label>
            <label>{isBuy ? "买入" : "卖出"}日期<input name="date" type="date" defaultValue="2026-07-29" required /></label>
            {isBuy && <label>最多能接受亏损<input name="maxLoss" type="number" placeholder="例如 1000 元" /></label>}
          </div>
          <fieldset><legend>为什么{isBuy ? "买" : "卖"}？</legend><div className="reason-options">{reasons.map((reason, index) => <label key={reason}><input type="radio" name="reason" value={reason} defaultChecked={index === 0} /><span>{reason}</span></label>)}</div></fieldset>
          {isBuy && <div className="calculation-tip"><b>保存后系统会帮你算：</b>持仓成本、最大亏损比例，以及 1R / 2R 止盈参考。</div>}
          <div className="modal-actions"><button type="button" onClick={onClose}>取消</button><button className="primary-button" type="submit">保存{isBuy ? "买入" : "卖出"}记录</button></div>
        </form>
      </section>
    </div>
  );
}
