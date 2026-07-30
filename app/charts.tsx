"use client";

/** 占比环图（DonutChart）与排行条形图（BarList）用纯 SVG 实现，零依赖、在
 * Cloudflare 边缘环境稳定渲染。
 *
 * 资金权益曲线已迁移到 lightweight-charts（见 equity-chart.tsx），以获得
 * 专业金融图表的缩放/十字光标交互体验。
 */

function formatCents(cents: number): string {
  const value = cents / 100;
  const sign = value < 0 ? "-" : "";
  return `${sign}¥${Math.abs(value).toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`;
}

export function BarList({
  items,
  format = (value) => formatCents(value),
}: {
  items: Array<{ label: string; value: number; sub?: string }>;
  format?: (value: number) => string;
}) {
  if (!items.length) return <p className="chart-empty">暂无数据。</p>;
  const maxAbs = Math.max(...items.map((item) => Math.abs(item.value)), 1);
  return (
    <ul className="bar-list">
      {items.map((item) => {
        const widthPercent = (Math.abs(item.value) / maxAbs) * 100;
        const tone = item.value > 0 ? "bar--profit" : item.value < 0 ? "bar--loss" : "bar--flat";
        return (
          <li key={item.label} className="bar-row">
            <span className="bar-label" title={item.label}>{item.label}</span>
            <span className="bar-track">
              <span className={`bar-fill ${tone}`} style={{ width: `${widthPercent}%` }} />
            </span>
            <span className="bar-value">{format(item.value)}{item.sub ? <small> {item.sub}</small> : null}</span>
          </li>
        );
      })}
    </ul>
  );
}

const DONUT_PALETTE = [
  "var(--accent)", "#5b8def", "#e0a458", "#7bc47f", "#c879b8",
  "#6cc5c0", "#d98b6b", "#9b8cff", "#b5c967", "#e07979",
];

export function DonutChart({
  segments,
  size = 180,
}: {
  segments: Array<{ label: string; value: number }>;
  size?: number;
}) {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
  if (total <= 0) return <p className="chart-empty">暂无持仓占比数据。</p>;
  const radius = size / 2 - 12;
  const innerRadius = radius * 0.58;
  const center = size / 2;
  const fractions = segments.map((s) => Math.max(0, s.value) / total);
  const startAngles = fractions.reduce<number[]>((acc, f, i) => {
    const base = i === 0 ? -Math.PI / 2 : acc[i - 1] + fractions[i - 1] * Math.PI * 2;
    acc.push(base);
    return acc;
  }, []);
  const arcs = segments.map((segment, index) => {
    const fraction = fractions[index];
    const start = startAngles[index];
    const end = start + fraction * Math.PI * 2;
    const largeArc = fraction > 0.5 ? 1 : 0;
    const x1 = center + radius * Math.cos(start);
    const y1 = center + radius * Math.sin(start);
    const x2 = center + radius * Math.cos(end);
    const y2 = center + radius * Math.sin(end);
    const ix2 = center + innerRadius * Math.cos(end);
    const iy2 = center + innerRadius * Math.sin(end);
    const ix1 = center + innerRadius * Math.cos(start);
    const iy1 = center + innerRadius * Math.sin(start);
    const path = `M${x1.toFixed(2)},${y1.toFixed(2)} A${radius},${radius} 0 ${largeArc} 1 ${x2.toFixed(2)},${y2.toFixed(2)} L${ix2.toFixed(2)},${iy2.toFixed(2)} A${innerRadius},${innerRadius} 0 ${largeArc} 0 ${ix1.toFixed(2)},${iy1.toFixed(2)} Z`;
    return { path, label: segment.label, color: DONUT_PALETTE[index % DONUT_PALETTE.length], percent: fraction * 100 };
  });
  return (
    <div className="donut-wrap">
      <svg className="donut-chart" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="持仓占比">
        {arcs.map((arc) => (
          <path key={arc.label} d={arc.path} fill={arc.color} className="donut-segment" />
        ))}
        <text x={center} y={center - 4} className="donut-center" textAnchor="middle">{segments.length}</text>
        <text x={center} y={center + 14} className="donut-center-sub" textAnchor="middle">只持仓</text>
      </svg>
      <ul className="donut-legend">
        {arcs.map((arc) => (
          <li key={arc.label}>
            <span className="donut-dot" style={{ background: arc.color }} />
            <span className="donut-legend-label" title={arc.label}>{arc.label}</span>
            <span className="donut-legend-percent">{arc.percent.toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
