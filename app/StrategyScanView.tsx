"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
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
    const onResize = () => chart.applyOptions({ width: container.clientWidth || 600 });
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.remove();
    };
  }, [points]);
  return <div ref={ref} role="img" aria-label="策略组合净值曲线" />;
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

/* ------------------------------ 主视图 ------------------------------ */
export function StrategyScanView() {
  const [scan, setScan] = useState<Scan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/strategy-scan");
        const json = (await res.json()) as { ok: boolean; scan?: Scan; error?: string };
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

  if (loading) {
    return (
      <div className="loading-state">
        <Spinner /> 正在加载策略扫描结果…
      </div>
    );
  }
  if (error || !scan) {
    return (
      <Banner tone="warn" title="暂无策略扫描数据">
        {error || "请先在本地运行 trading_agent 生成共享扫描 JSON。"}
      </Banner>
    );
  }

  const fm = scan.backtest.finalMetrics;
  const opt = scan.backtest.optimized;

  return (
    <div className="scan-view" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <SectionHeader
        eyebrow="交易 Agent · 文件桥"
        title="策略扫描"
        subtitle={`候选池 ${scan.universeSize} 只 → 选出 ${scan.selectedCount} 只 ｜ 生成于 ${scan.generatedAt}`}
        desc="由 trading_agent 回测引擎生成，经文件桥同步到本页展示。"
      />

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
        <CardHeader title="选股榜单（多因子打分）" desc="动量 + 估值 + 流动性加权打分，取 Top N。" />
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle()}>代码</th>
              <th style={thStyle()}>名称</th>
              <th style={thStyle()}>得分</th>
              <th style={thStyle()}>动量(20d)</th>
              <th style={thStyle()}>PE</th>
              <th style={thStyle()}>PB</th>
              <th style={thStyle()}>换手%</th>
              <th style={thStyle()}>信号数</th>
            </tr>
          </thead>
          <tbody>
            {scan.selected.map((s) => (
              <tr key={s.code}>
                <td style={tdStyle()}>{s.code}</td>
                <td style={tdStyle()}>{s.name}</td>
                <td style={tdStyle()}>{s.score.toFixed(3)}</td>
                <td style={tdStyle()}>
                  <Tag tone={s.momentum >= 0 ? "up" : "down"}>{pct(s.momentum)}</Tag>
                </td>
                <td style={tdStyle()}>{s.peTtm.toFixed(2)}</td>
                <td style={tdStyle()}>{s.pb.toFixed(2)}</td>
                <td style={tdStyle()}>{s.turnover.toFixed(2)}</td>
                <td style={tdStyle()}>{s.signals}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {opt && (
        <Card>
          <CardHeader title="参数网格搜索 Top" desc="按夏普排序的参数组合表现。" />
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
        </Card>
      )}

      <Hint>{scan.disclaimer}</Hint>
    </div>
  );
}
