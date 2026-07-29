"use client";

import { FormEvent, useMemo, useState } from "react";

type View = "overview" | "trades" | "review" | "watchlist" | "stats";

type Trade = {
  id: number;
  symbol: string;
  name: string;
  side: "买入" | "卖出";
  price: number;
  quantity: number;
  tradedAt: string;
  reason: string;
  plan: string;
};

const navItems: { id: View; label: string; icon: string }[] = [
  { id: "overview", label: "今日概览", icon: "⌂" },
  { id: "trades", label: "交易记录", icon: "↕" },
  { id: "review", label: "复盘中心", icon: "✎" },
  { id: "watchlist", label: "重点关注", icon: "☆" },
  { id: "stats", label: "数据洞察", icon: "⌁" },
];

const holdings = [
  { symbol: "600519", name: "贵州茅台", theme: "白酒 · 大消费", price: "1,512.80", change: "+1.26%", profit: "+8.42%", risk: "安全", riskClass: "safe" },
  { symbol: "300750", name: "宁德时代", theme: "固态电池 · 新能源", price: "284.63", change: "-0.88%", profit: "+3.17%", risk: "接近止盈", riskClass: "warn" },
  { symbol: "688981", name: "中芯国际", theme: "国产替代 · 芯片", price: "92.41", change: "+3.52%", profit: "-2.64%", risk: "观察", riskClass: "neutral" },
];

const initialTrades: Trade[] = [
  { id: 1, symbol: "300750", name: "宁德时代", side: "买入", price: 275.88, quantity: 100, tradedAt: "07-26 10:18", reason: "回踩20日线企稳，固态电池板块强度仍在", plan: "跌破268止损，目标位296" },
  { id: 2, symbol: "600519", name: "贵州茅台", side: "卖出", price: 1538.2, quantity: 100, tradedAt: "07-24 14:37", reason: "到达第一止盈位，按计划减半仓", plan: "剩余仓位移动止损至1480" },
  { id: 3, symbol: "688981", name: "中芯国际", side: "买入", price: 94.92, quantity: 300, tradedAt: "07-22 09:42", reason: "国产替代逻辑延续，突破前高后首次回踩", plan: "跌破90.5离场，不补仓" },
];

const focusStocks = [
  { name: "胜宏科技", symbol: "300476", theme: "PCB · AI算力", change: "+4.82%", signal: "等待回踩", note: "不追高，缩量回踩5日线再看" },
  { name: "北方华创", symbol: "002371", theme: "半导体设备", change: "+1.35%", signal: "临近买点", note: "突破前高放量才确认" },
  { name: "紫金矿业", symbol: "601899", theme: "黄金 · 有色", change: "-0.62%", signal: "观察", note: "美元走弱逻辑，等板块共振" },
];

const stats = [
  { value: "63.6%", label: "近30日胜率", detail: "较上月 +5.2%", tone: "green" },
  { value: "2.31", label: "平均盈亏比", detail: "目标 ≥ 2.0", tone: "amber" },
  { value: "+8.7%", label: "本月收益", detail: "沪深300 +2.1%", tone: "red" },
  { value: "11", label: "已完成交易", detail: "7盈 · 4亏", tone: "blue" },
];

export function Dashboard() {
  const [view, setView] = useState<View>("overview");
  const [trades, setTrades] = useState(initialTrades);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [reviewDone, setReviewDone] = useState(false);

  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  async function addTrade(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const newTrade: Trade = {
      id: Date.now(),
      symbol: String(form.get("symbol")),
      name: String(form.get("name")),
      side: form.get("side") as "买入" | "卖出",
      price: Number(form.get("price")),
      quantity: Number(form.get("quantity")),
      tradedAt: "刚刚",
      reason: String(form.get("reason")),
      plan: String(form.get("plan")),
    };

    setTrades((current) => [newTrade, ...current]);
    setIsModalOpen(false);
    event.currentTarget.reset();
    flash("交易已记录，晚间复盘会自动包含这一笔");

    try {
      await fetch("/api/trades", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(newTrade),
      });
    } catch {
      // The local preview remains useful before cloud storage is connected.
    }
  }

  const title = useMemo(() => navItems.find((item) => item.id === view)?.label, [view]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setView("overview")} aria-label="返回今日概览">
          <span className="brand-mark">复</span>
          <span>
            <strong>复盘簿</strong>
            <small>交易有迹可循</small>
          </span>
        </button>

        <nav aria-label="主导航">
          <p className="nav-label">工作台</p>
          {navItems.map((item) => (
            <button
              key={item.id}
              className={view === item.id ? "nav-item active" : "nav-item"}
              onClick={() => setView(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
              {item.id === "review" && <span className="nav-dot" aria-label="有待复盘内容" />}
            </button>
          ))}
        </nav>

        <div className="discipline-card">
          <span className="eyebrow">本月纪律分</span>
          <div className="score-row"><strong>84</strong><span>/ 100</span></div>
          <div className="score-track"><i style={{ width: "84%" }} /></div>
          <p>最大改进项：减少计划外追高</p>
        </div>

        <button className="profile">
          <span className="avatar">陈</span>
          <span><strong>我的交易账户</strong><small>个人空间</small></span>
          <span className="chevron">›</span>
        </button>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <span className="mobile-brand">复盘簿</span>
            <p className="date">2026年7月29日 · 星期三</p>
            <h1>{title}</h1>
          </div>
          <div className="top-actions">
            <div className="market-state"><span /> A股已收盘 <small>数据更新于 15:08</small></div>
            <button className="icon-button" aria-label="提醒">♢<i /></button>
            <button className="primary-button" onClick={() => setIsModalOpen(true)}><span>＋</span> 记录交易</button>
          </div>
        </header>

        {view === "overview" && (
          <Overview
            trades={trades}
            reviewDone={reviewDone}
            onReview={() => {
              setReviewDone(true);
              flash("今日复盘已完成，纪律分 +2");
            }}
            onNavigate={setView}
          />
        )}
        {view === "trades" && <TradesView trades={trades} onAdd={() => setIsModalOpen(true)} />}
        {view === "review" && <ReviewView reviewDone={reviewDone} onDone={() => { setReviewDone(true); flash("复盘已保存"); }} />}
        {view === "watchlist" && <WatchlistView />}
        {view === "stats" && <StatsView />}
      </main>

      <nav className="mobile-nav" aria-label="移动端导航">
        {navItems.map((item) => (
          <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}>
            <span>{item.icon}</span>{item.label.slice(0, 2)}
          </button>
        ))}
      </nav>

      {isModalOpen && <TradeModal onClose={() => setIsModalOpen(false)} onSubmit={addTrade} />}
      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </div>
  );
}

function Overview({ trades, reviewDone, onReview, onNavigate }: {
  trades: Trade[];
  reviewDone: boolean;
  onReview: () => void;
  onNavigate: (view: View) => void;
}) {
  return (
    <div className="page-content">
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow light">收盘后 · 先看计划，再看盈亏</span>
          <h2>今天，有两件事值得复盘。</h2>
          <p>宁德时代接近第一止盈位；中芯国际的入场逻辑需要在今晚确认。</p>
          <button className="hero-button" onClick={() => onNavigate("review")}>开始今日复盘 <span>→</span></button>
        </div>
        <div className="hero-quote">
          <span>今日交易原则</span>
          <blockquote>“好的交易不是每次都赢，而是每次都按计划行动。”</blockquote>
          <small>连续 6 个交易日遵守止损纪律</small>
        </div>
        <div className="hero-lines" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></div>
      </section>

      <section className="stats-grid" aria-label="本月关键统计">
        {stats.map((item) => (
          <article className="stat-card" key={item.label}>
            <div className={`stat-icon ${item.tone}`}>{item.tone === "green" ? "◎" : item.tone === "amber" ? "◇" : item.tone === "red" ? "↗" : "≡"}</div>
            <div><strong>{item.value}</strong><span>{item.label}</span></div>
            <small>{item.detail}</small>
          </article>
        ))}
      </section>

      <div className="content-grid">
        <section className="panel holdings-panel">
          <PanelHeader title="当前持仓" subtitle="3 只股票 · 总仓位 62%" action="查看全部" onAction={() => onNavigate("trades")} />
          <div className="holding-head"><span>股票 / 题材</span><span>现价 / 涨跌</span><span>持仓收益</span><span>计划状态</span></div>
          {holdings.map((stock) => (
            <button className="holding-row" key={stock.symbol}>
              <span className="stock-name"><b>{stock.name}</b><small>{stock.symbol} · {stock.theme}</small></span>
              <span><b>{stock.price}</b><small className={stock.change.startsWith("+") ? "up" : "down"}>{stock.change}</small></span>
              <span className={stock.profit.startsWith("+") ? "profit" : "loss"}>{stock.profit}</span>
              <span><i className={`status-dot ${stock.riskClass}`} />{stock.risk}<small className="row-arrow">›</small></span>
            </button>
          ))}
        </section>

        <section className="panel task-panel">
          <PanelHeader title="今日待办" subtitle={reviewDone ? "已全部完成" : "完成复盘闭环"} />
          <div className="task-progress"><span><i style={{ width: reviewDone ? "100%" : "50%" }} /></span><small>{reviewDone ? "3 / 3" : "2 / 3"}</small></div>
          <label className="task done"><input type="checkbox" checked readOnly /><span>检查持仓止盈止损<small>3 只持仓均在计划范围内</small></span></label>
          <label className="task done"><input type="checkbox" checked readOnly /><span>记录今日交易<small>今日无新增交易</small></span></label>
          <label className={reviewDone ? "task done" : "task"}>
            <input type="checkbox" checked={reviewDone} onChange={onReview} />
            <span>完成收盘复盘<small>{reviewDone ? "已完成，做得不错" : "预计用时 5 分钟"}</small></span>
          </label>
          {!reviewDone && <button className="task-button" onClick={onReview}>完成今日复盘</button>}
        </section>

        <section className="panel review-panel">
          <PanelHeader title="最近交易" subtitle="按操作时间排序" action="交易记录" onAction={() => onNavigate("trades")} />
          {trades.slice(0, 3).map((trade) => (
            <article className="trade-row" key={trade.id}>
              <span className={trade.side === "买入" ? "side buy" : "side sell"}>{trade.side}</span>
              <span className="stock-name"><b>{trade.name}</b><small>{trade.symbol} · {trade.tradedAt}</small></span>
              <span className="trade-reason">{trade.reason}</span>
              <span className="trade-value"><b>¥{trade.price.toFixed(2)}</b><small>{trade.quantity} 股</small></span>
            </article>
          ))}
        </section>

        <section className="panel focus-panel">
          <PanelHeader title="重点关注" subtitle="盘后题材强度已更新" action="管理" onAction={() => onNavigate("watchlist")} />
          {focusStocks.map((stock) => (
            <button className="focus-row" key={stock.symbol}>
              <span className="focus-star">★</span>
              <span className="stock-name"><b>{stock.name}</b><small>{stock.theme}</small></span>
              <span className={stock.change.startsWith("+") ? "up" : "down"}>{stock.change}</span>
              <span className="signal">{stock.signal}</span>
            </button>
          ))}
        </section>
      </div>
    </div>
  );
}

function TradesView({ trades, onAdd }: { trades: Trade[]; onAdd: () => void }) {
  return (
    <div className="page-content inner-page">
      <section className="section-intro">
        <div><span className="eyebrow">完整操作流水</span><h2>交易记录</h2><p>把买卖动作和当时的判断放在一起，避免只用结果评价自己。</p></div>
        <button className="primary-button" onClick={onAdd}>＋ 记录一笔交易</button>
      </section>
      <div className="filter-bar">
        <button className="filter active">全部交易 <span>{trades.length}</span></button>
        <button className="filter">持仓中 <span>3</span></button>
        <button className="filter">已清仓 <span>8</span></button>
        <span className="filter-spacer" />
        <button className="date-filter">近 30 天⌄</button>
      </div>
      <section className="panel trade-table">
        <div className="table-head"><span>时间 / 操作</span><span>股票</span><span>成交</span><span>交易依据</span><span>执行计划</span></div>
        {trades.map((trade) => (
          <article className="table-row" key={trade.id}>
            <span><b className={trade.side === "买入" ? "side buy" : "side sell"}>{trade.side}</b><small>{trade.tradedAt}</small></span>
            <span className="stock-name"><b>{trade.name}</b><small>{trade.symbol}</small></span>
            <span><b>¥{trade.price.toFixed(2)}</b><small>{trade.quantity} 股</small></span>
            <span className="long-copy">{trade.reason}</span>
            <span className="long-copy">{trade.plan}</span>
          </article>
        ))}
      </section>
    </div>
  );
}

function ReviewView({ reviewDone, onDone }: { reviewDone: boolean; onDone: () => void }) {
  const [mood, setMood] = useState("平静");
  const [lesson, setLesson] = useState("");
  return (
    <div className="page-content inner-page review-page">
      <section className="section-intro">
        <div><span className="eyebrow">5 分钟收盘仪式</span><h2>今日复盘</h2><p>先检验交易逻辑，再记录情绪与改进。系统会把答案沉淀为你的交易模式。</p></div>
        <span className={reviewDone ? "completion-badge done" : "completion-badge"}>{reviewDone ? "✓ 今日已完成" : "待完成"}</span>
      </section>
      <div className="review-grid">
        <section className="panel review-form">
          <span className="step-label">01 · 计划执行</span>
          <h3>今天是否严格执行了交易计划？</h3>
          <div className="choice-grid">
            <button className="choice selected"><b>✓</b><span>完全执行<small>没有计划外操作</small></span></button>
            <button className="choice"><b>~</b><span>部分执行<small>有一处轻微偏离</small></span></button>
            <button className="choice"><b>!</b><span>明显偏离<small>需要重点回看</small></span></button>
          </div>
          <span className="step-label">02 · 交易情绪</span>
          <h3>今天操作时的主要情绪是什么？</h3>
          <div className="mood-row">
            {["平静", "犹豫", "兴奋", "焦虑", "后悔"].map((item) => <button className={mood === item ? "mood selected" : "mood"} onClick={() => setMood(item)} key={item}>{item}</button>)}
          </div>
          <label className="text-label" htmlFor="lesson">03 · 今天最重要的一点收获</label>
          <textarea id="lesson" value={lesson} onChange={(event) => setLesson(event.target.value)} placeholder="例如：板块已经加速时，不应该因为怕错过而追高……" />
          <button className="primary-button wide" onClick={onDone}>{reviewDone ? "更新今日复盘" : "保存并完成复盘"}</button>
        </section>
        <aside className="review-aside">
          <section className="panel insight-card">
            <span className="eyebrow">系统发现</span>
            <h3>你在“兴奋”状态下的胜率明显更低</h3>
            <div className="mini-chart"><i style={{ height: "72%" }} /><i style={{ height: "46%" }} /><i className="alert" style={{ height: "28%" }} /><i style={{ height: "55%" }} /><i style={{ height: "65%" }} /></div>
            <p>近 12 笔计划外交易中，有 7 笔发生在板块大涨当日。建议把“当日涨幅超过 5% 不开新仓”加入交易规则。</p>
            <button>加入我的交易规则 →</button>
          </section>
          <section className="panel streak-card">
            <span>连续复盘</span><strong>6 <small>天</small></strong><p>保持下去，你正在建立可复制的交易系统。</p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function WatchlistView() {
  return (
    <div className="page-content inner-page">
      <section className="section-intro">
        <div><span className="eyebrow">机会池，不是购物车</span><h2>重点关注</h2><p>每只股票都要写下触发条件。条件未出现，就不交易。</p></div>
        <button className="primary-button">＋ 添加关注</button>
      </section>
      <div className="watch-grid">
        {focusStocks.concat([{ name: "工业富联", symbol: "601138", theme: "AI服务器 · 算力", change: "+2.18%", signal: "等待确认", note: "成交额需重回5日均值之上" }]).map((stock, index) => (
          <article className="panel watch-card" key={stock.symbol}>
            <div className="watch-top"><span className="focus-star">★</span><span className={stock.change.startsWith("+") ? "up" : "down"}>{stock.change}</span></div>
            <h3>{stock.name}<small>{stock.symbol}</small></h3>
            <p className="theme-tag">{stock.theme}</p>
            <div className="watch-rule"><span>我的观察条件</span><p>{stock.note}</p></div>
            <div className="watch-bottom"><span className={`signal ${index === 1 ? "hot" : ""}`}>{stock.signal}</span><button>查看题材脉络 →</button></div>
          </article>
        ))}
      </div>
      <section className="panel theme-map">
        <PanelHeader title="题材脉络" subtitle="根据你的持仓与关注股票自动归类" />
        <div className="theme-nodes">
          <div className="theme-node primary"><strong>AI 算力</strong><span>3 只关注</span></div>
          <i />
          <div className="theme-node"><strong>PCB</strong><span>胜宏科技</span></div>
          <div className="theme-node"><strong>服务器</strong><span>工业富联</span></div>
          <div className="theme-node"><strong>半导体设备</strong><span>北方华创</span></div>
        </div>
      </section>
    </div>
  );
}

function StatsView() {
  return (
    <div className="page-content inner-page">
      <section className="section-intro"><div><span className="eyebrow">不看运气，看模式</span><h2>数据洞察</h2><p>从结果、执行和情绪三个维度理解自己的交易系统。</p></div><button className="date-filter">2026年7月⌄</button></section>
      <section className="stats-grid">{stats.map((item) => <article className="stat-card large" key={item.label}><div className={`stat-icon ${item.tone}`}>↗</div><div><strong>{item.value}</strong><span>{item.label}</span></div><small>{item.detail}</small></article>)}</section>
      <div className="analytics-grid">
        <section className="panel performance-chart">
          <PanelHeader title="累计收益曲线" subtitle="对比沪深300" />
          <div className="chart-legend"><span><i className="mine" />我的收益 +8.7%</span><span><i />沪深300 +2.1%</span></div>
          <div className="line-chart">
            <div className="chart-labels"><span>+10%</span><span>+5%</span><span>0%</span><span>-5%</span></div>
            <div className="chart-grid-lines"><i /><i /><i /><i /></div>
            <div className="chart-line benchmark" />
            <div className="chart-line personal" />
          </div>
        </section>
        <section className="panel mistake-panel">
          <PanelHeader title="亏损原因分布" subtitle="近 20 笔亏损交易" />
          {[["计划外追高", 42], ["止损执行过晚", 26], ["题材强度误判", 18], ["仓位过重", 14]].map(([name, value]) => (
            <div className="reason-bar" key={name}><span>{name}</span><div><i style={{ width: `${value}%` }} /></div><b>{value}%</b></div>
          ))}
          <p className="panel-note">首要改进：增加追高限制，可以规避约 42% 的历史亏损。</p>
        </section>
        <section className="panel rule-panel">
          <PanelHeader title="纪律执行趋势" subtitle="最近 8 周" />
          <div className="week-bars">{[64, 68, 62, 72, 76, 74, 81, 84].map((value, index) => <div key={index}><i style={{ height: `${value}%` }} /><span>W{index + 1}</span></div>)}</div>
        </section>
      </div>
    </div>
  );
}

function PanelHeader({ title, subtitle, action, onAction }: { title: string; subtitle: string; action?: string; onAction?: () => void }) {
  return <header className="panel-header"><div><h3>{title}</h3><p>{subtitle}</p></div>{action && <button onClick={onAction}>{action} <span>→</span></button>}</header>;
}

function TradeModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="trade-title">
        <header><div><span className="eyebrow">完整记录，才有有效复盘</span><h2 id="trade-title">记录一笔交易</h2></div><button onClick={onClose} aria-label="关闭">×</button></header>
        <form onSubmit={onSubmit}>
          <div className="form-grid">
            <label>股票名称<input name="name" placeholder="例如：宁德时代" required /></label>
            <label>股票代码<input name="symbol" placeholder="例如：300750" inputMode="numeric" required /></label>
            <label>操作<select name="side"><option>买入</option><option>卖出</option></select></label>
            <label>成交价格<input name="price" type="number" step="0.01" placeholder="0.00" required /></label>
            <label>成交数量<input name="quantity" type="number" step="100" placeholder="100" required /></label>
          </div>
          <label>为什么此刻交易？<textarea name="reason" placeholder="写下当时看到的信号和判断…" required /></label>
          <label>止盈止损与后续计划<textarea name="plan" placeholder="例如：跌破268止损，第一目标位296…" required /></label>
          <div className="modal-actions"><button type="button" onClick={onClose}>取消</button><button className="primary-button" type="submit">保存交易记录</button></div>
        </form>
      </section>
    </div>
  );
}
