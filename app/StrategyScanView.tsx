"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  createChart,
  ColorType,
  LineSeries,
  type UTCTimestamp,
} from "lightweight-charts";
import {
  SectionHeader,
  Stat,
  Card,
  CardHeader,
  Tag,
  Banner,
  Hint,
  Spinner,
} from "./components";
import { ScreenerConfigPanel, type ScreenerOverrides } from "./ScreenerConfigPanel";

/* ----------------------------- 数据类型 ----------------------------- */
type ScanSelected = {
  code: string;
  name: string;
  score: number;
  momentum: number;
  peTtm: number;
  pb: number;
  turnover: number;
  signals: number;
  /** 新增因子维度（丰富选股策略）；旧 payload 可能缺失，故可选 */
  rsi?: number;
  riskAdjMomentum?: number;
  trend?: number;
  factors?: Record<string, number>;
  /** 行业（行业分散约束）；旧 payload 可能缺失，故可选 */
  sector?: string;
};
type ScanMetrics = {
  totalReturn: number;
  annualReturn: number;
  sharpe: number;
  maxDrawdown: number;
  winRate: number;
  trades: number;
};
type ScanSignal = { fastMa: number; slowMa: number };
type ScanGridItem = {
  fastMa: number;
  slowMa: number;
  metric: number;
  totalReturn: number;
  maxDrawdown: number;
};
type Scan = {
  generatedAt: string;
  period: { beg: string; end: string };
  universeSize: number;
  selectedCount: number;
  selected: ScanSelected[];
  backtest: {
    baseSignal: ScanSignal;
    baseMetrics: ScanMetrics;
    finalSignal: ScanSignal;
    finalMetrics: ScanMetrics;
    optimized?: {
      bestSignal: ScanSignal;
      bestMetrics: ScanMetrics;
      sharpeImprovement: number;
      grid: ScanGridItem[];
    };
  };
  equityCurve: Array<{ date: string; value: number }>;
  marketState?: {
    state: string;
    positionFactor: number;
    score: number;
    detail: string;
    maGap: number;
    momentum: number;
  };
  disclaimer: string;
};

function pct(x: number): string {
  return `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}%`;
}

const NEUTRAL_BORDER = "rgba(148,163,184,0.2)";

/* --------------------------- 净值曲线组件 --------------------------- */
function StrategyCurveChart({ points }: { points: Array<{ date: string; value: number }> }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = ref.current;
    if (!container || points.length === 0) return;
    const chart = createChart(container, {
      height: 240,
      width: container.clientWidth || 600,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#64748b",
        fontFamily: "inherit",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(148,163,184,0.14)" },
        horzLines: { color: "rgba(148,163,184,0.14)" },
      },
      rightPriceScale: { borderColor: NEUTRAL_BORDER },
      timeScale: { borderColor: NEUTRAL_BORDER, timeVisible: false, secondsVisible: false },
      crosshair: { mode: 0 },
      handleScale: false,
      handleScroll: false,
    });
    const series = chart.addSeries(LineSeries, {
      color: "#2563eb",
      lineWidth: 2,
      priceFormat: { type: "custom", minMove: 0.0001, formatter: (p: number) => p.toFixed(4) },
    });
    const data = points
      .map((p) => ({
        time: (Date.parse(`${p.date}T00:00:00Z`) / 1000) as UTCTimestamp,
        value: p.value,
      }))
      .sort((a, b) => (a.time as number) - (b.time as number));
    series.setData(data);
    if (data.length) chart.timeScale().setVisibleLogicalRange({ from: -0.5, to: data.length - 0.5 });

    // 用 ResizeObserver 让宽度随卡片自适应，避免首帧 clientWidth 为 0 时
    // 以固定 600 宽创建、布局稳定后再跳变宽度造成的页面闪烁。
    const syncWidth = () => {
      const w = container.clientWidth;
      if (w) chart.applyOptions({ width: w });
    };
    syncWidth();
    const ro = new ResizeObserver(syncWidth);
    ro.observe(container);
    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [points]);
  return (
    <div
      ref={ref}
      role="img"
      aria-label="策略组合净值曲线"
      style={{ width: "100%" }}
    />
  );
}

/* ------------------------------ 表格样式 ------------------------------ */
const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 13,
};
function thStyle(): CSSProperties {
  return {
    padding: "8px 10px",
    textAlign: "left",
    color: "#64748b",
    borderBottom: `1px solid ${NEUTRAL_BORDER}`,
    fontWeight: 600,
  };
}
function tdStyle(): CSSProperties {
  return { padding: "8px 10px", borderBottom: "1px solid rgba(148,163,184,0.12)" };
}
function feedbackBtn(active: boolean): CSSProperties {
  return {
    cursor: "pointer",
    padding: "3px 9px",
    fontSize: 12,
    borderRadius: 6,
    border: active ? "1px solid currentColor" : "1px solid rgba(148,163,184,0.3)",
    background: active ? "rgba(148,163,184,0.12)" : "transparent",
    color: "rgba(148,163,184,0.85)",
  };
}
function verdictOf(feedback: Record<string, "有效" | "无效">, symbol: string): "有效" | "无效" | "" {
  return feedback[symbol] || "";
}

/* ------------------------------ 主视图 ------------------------------ */
export type StrategyScanResponse = { ok: boolean; scan?: Scan; error?: string };

export function StrategyScanView({
  initialData,
  onRefresh,
}: {
  initialData?: StrategyScanResponse | null;
  onRefresh?: () => void | Promise<void>;
}) {
  const [scan, setScan] = useState<Scan | null>(initialData?.ok ? initialData.scan ?? null : null);
  // 若顶层已预取数据，则直接进入“已加载”状态，避免进入时骨架屏闪烁一次
  const [loading, setLoading] = useState(!initialData || !initialData.ok);
  const [error, setError] = useState(initialData && !initialData.ok ? initialData.error || "暂时无法读取策略扫描结果" : "");
  const [feedback, setFeedback] = useState<Record<string, "有效" | "无效">>({});
  const [feedbackBusy, setFeedbackBusy] = useState("");
  const [scanBusy, setScanBusy] = useState(false);
  const [scanError, setScanError] = useState("");

  const load = useCallback(() => {
    let alive = true;
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/strategy-scan");
        const json = (await res.json()) as StrategyScanResponse;
        if (!alive) return;
        if (json.ok && json.scan) setScan(json.scan);
        else setError(json.error || "暂时无法读取策略扫描结果");
      } catch {
        if (alive) setError("暂时无法读取策略扫描结果");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    // 仅在顶层未预取数据时才自行拉取，避免进入页面时重复加载造成闪烁
    if (initialData?.ok && initialData.scan) return;
    let cleanup: (() => void) | undefined;
    const timer = window.setTimeout(() => {
      cleanup = load();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      cleanup?.();
    };
  }, [initialData, load]);

  async function submitFeedback(symbol: string, name: string, verdict: "有效" | "无效") {
    if (feedbackBusy) return;
    setFeedbackBusy(symbol + verdict);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, name, verdict, source: "web" }),
      });
      if (res.ok) setFeedback((prev) => ({ ...prev, [symbol]: verdict }));
    } finally {
      setFeedbackBusy("");
    }
  }

  async function handleRunInteractive(overrides: ScreenerOverrides) {
    setScanBusy(true);
    setScanError("");
    try {
      const res = await fetch("/api/strategy-scan/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(overrides),
      });
      const json = (await res.json()) as { ok?: boolean; scan?: Scan; error?: string };
      if (json.ok && json.scan) {
        setScan(json.scan);
      } else {
        setScanError(json.error || "扫描执行失败");
      }
    } catch {
      setScanError("网络错误：无法连接扫描引擎");
    } finally {
      setScanBusy(false);
    }
  }

  if (loading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <ScreenerConfigPanel onRun={handleRunInteractive} busy={scanBusy} />
        {scanError && <Banner tone="warn" title="扫描失败">{scanError}</Banner>}
        <div className="loading-state" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Spinner /> 正在加载策略扫描结果…
        </div>
      </div>
    );
  }
  if (error || !scan || !scan.backtest) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <ScreenerConfigPanel onRun={handleRunInteractive} busy={scanBusy} />
        {scanError && <Banner tone="warn" title="扫描失败">{scanError}</Banner>}
        <Banner tone="warn" title="暂无策略扫描数据">
          {error ||
            (!scan
              ? "请先在本地运行 trading_agent 生成共享扫描 JSON，或使用上方配置面板触发扫描。"
              : "扫描结果缺少回测数据（backtest），请重新在本地运行 trading_agent 生成完整共享 JSON。")}
        </Banner>
      </div>
    );
  }

  const fm = scan.backtest.finalMetrics;
  const opt = scan.backtest.optimized;

  return (
    <div className="scan-view" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* 交互式配置面板 */}
      <ScreenerConfigPanel onRun={handleRunInteractive} busy={scanBusy} />

      {scanError && (
        <Banner tone="warn" title="扫描失败">
          {scanError}
        </Banner>
      )}

      <SectionHeader
        eyebrow="交易 Agent · 文件桥"
        title="策略扫描"
        subtitle={`候选池 ${scan.universeSize} 只 → 选出 ${scan.selectedCount} 只 ｜ 生成于 ${scan.generatedAt}`}
        desc="由 trading_agent 回测引擎生成，经文件桥同步到本页展示。"
      />

      {scan.marketState && (
        (() => {
          const ms = scan.marketState!;
          const tone =
            ms.state === "bull" ? "success" : ms.state === "bear" ? "danger" : "info";
          const label =
            ms.state === "bull" ? "牛市 · 满仓" : ms.state === "bear" ? "熊市 · 空仓" : ms.state === "neutral" ? "中性 · 半仓" : "未知 · 中性";
          return (
            <Banner tone={tone} title={`市场状态：${label}（仓位系数 ${ms.positionFactor.toFixed(2)}）`}>
              {ms.detail}
            </Banner>
          );
        })()
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 12,
        }}
      >
        <Stat
          label="最终信号"
          value={`MA${scan.backtest.finalSignal.fastMa}/MA${scan.backtest.finalSignal.slowMa}`}
        />
        <Stat label="总收益" value={pct(fm.totalReturn)} hint={fm.totalReturn >= 0 ? "盈利" : "亏损"} />
        <Stat label="年化收益" value={pct(fm.annualReturn)} />
        <Stat label="夏普比率" value={fm.sharpe.toFixed(2)} hint="风险调整收益" />
        <Stat label="最大回撤" value={pct(fm.maxDrawdown)} hint="越低越好" />
        <Stat label="日胜率" value={pct(fm.winRate)} />
      </div>

      {opt && (
        <Banner
          tone="success"
          title={`参数优化有效：夏普 ${opt.sharpeImprovement >= 0 ? "+" : ""}${opt.sharpeImprovement.toFixed(2)}`}
        >
          优化后最佳参数 MA{opt.bestSignal.fastMa}/MA{opt.bestSignal.slowMa}，基准 MA
          {scan.backtest.baseSignal.fastMa}/MA{scan.backtest.baseSignal.slowMa}。
        </Banner>
      )}

      <Card>
        <CardHeader title="组合净值曲线" desc="策略在历史区间上的组合净值（起始归一化 1.0）。" />
        <StrategyCurveChart points={scan.equityCurve} />
      </Card>

      <Card>
        <CardHeader title="选股榜单（多因子打分）" desc="风险调整动量 + 趋势 + 估值 + RSI/MACD 技术确认 + 流动性/规模，加权打分取 Top N；行业分散约束限制单行业最多入选数。" />
        <div style={{ overflowX: "auto" }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle()}>代码</th>
              <th style={thStyle()}>名称</th>
              <th style={thStyle()}>行业</th>
              <th style={thStyle()}>得分</th>
              <th style={thStyle()}>动量(20d)</th>
              <th style={thStyle()}>RSI</th>
              <th style={thStyle()}>风险动量</th>
              <th style={thStyle()}>趋势</th>
              <th style={thStyle()}>PE</th>
              <th style={thStyle()}>PB</th>
              <th style={thStyle()}>换手%</th>
              <th style={thStyle()}>信号数</th>
              <th style={thStyle()}>反馈</th>
            </tr>
          </thead>
          <tbody>
            {scan.selected.map((s) => (
              <tr key={s.code}>
                <td style={tdStyle()}>{s.code}</td>
                <td style={tdStyle()}>{s.name}</td>
                <td style={tdStyle()}>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "2px 8px",
                      borderRadius: 6,
                      fontSize: 12,
                      lineHeight: "18px",
                      background: "rgba(37,99,235,0.12)",
                      color: "#3b82f6",
                      border: "1px solid rgba(37,99,235,0.25)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {s.sector ?? "其他"}
                  </span>
                </td>
                <td style={tdStyle()}>{s.score.toFixed(3)}</td>
                <td style={tdStyle()}>
                  <Tag tone={s.momentum >= 0 ? "up" : "down"}>{pct(s.momentum)}</Tag>
                </td>
                <td style={tdStyle()}>{s.rsi != null ? s.rsi.toFixed(1) : "-"}</td>
                <td style={tdStyle()}>
                  {s.factors ? `${(s.factors.momentum != null ? s.factors.momentum : 0) * 100 | 0}` : "-"}
                </td>
                <td style={tdStyle()}>
                  {s.factors ? `${(s.factors.trend != null ? s.factors.trend : 0) * 100 | 0}` : "-"}
                </td>
                <td style={tdStyle()}>{s.peTtm.toFixed(2)}</td>
                <td style={tdStyle()}>{s.pb.toFixed(2)}</td>
                <td style={tdStyle()}>{s.turnover.toFixed(2)}</td>
                <td style={tdStyle()}>{s.signals}</td>
                <td style={tdStyle()}>
                  <span style={{ display: "inline-flex", gap: 6 }}>
                    <button
                      type="button"
                      disabled={feedbackBusy === s.code + "有效"}
                      onClick={() => submitFeedback(s.code, s.name, "有效")}
                      style={{
                        ...feedbackBtn(verdictOf(feedback, s.code) === "有效"),
                        color: verdictOf(feedback, s.code) === "有效" ? "#0f6e56" : undefined,
                      }}
                    >
                      有效
                    </button>
                    <button
                      type="button"
                      disabled={feedbackBusy === s.code + "无效"}
                      onClick={() => submitFeedback(s.code, s.name, "无效")}
                      style={{
                        ...feedbackBtn(verdictOf(feedback, s.code) === "无效"),
                        color: verdictOf(feedback, s.code) === "无效" ? "#a32d2d" : undefined,
                      }}
                    >
                      无效
                    </button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </Card>

      {opt && (
        <Card>
          <CardHeader title="参数网格搜索 Top" desc="按夏普排序的参数组合表现。" />
          <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle()}>快线</th>
                <th style={thStyle()}>慢线</th>
                <th style={thStyle()}>夏普</th>
                <th style={thStyle()}>总收益</th>
                <th style={thStyle()}>最大回撤</th>
              </tr>
            </thead>
            <tbody>
              {opt.grid.map((g, i) => (
                <tr key={i}>
                  <td style={tdStyle()}>MA{g.fastMa}</td>
                  <td style={tdStyle()}>MA{g.slowMa}</td>
                  <td style={tdStyle()}>{g.metric.toFixed(3)}</td>
                  <td style={tdStyle()}>
                    <Tag tone={g.totalReturn >= 0 ? "up" : "down"}>{pct(g.totalReturn)}</Tag>
                  </td>
                  <td style={tdStyle()}>
                    <Tag tone={g.maxDrawdown >= 0 ? "up" : "down"}>{pct(g.maxDrawdown)}</Tag>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </Card>
      )}

      <Hint>{scan.disclaimer}</Hint>
    </div>
  );
}
