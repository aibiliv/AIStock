"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import {
  SectionHeader,
  Card,
  CardHeader,
  Tag,
  Banner,
  Hint,
  Spinner,
} from "./components";

/* ----------------------------- 数据类型 ----------------------------- */
export type WritebackSignal = {
  code: string;
  name: string;
  side: "BUY" | "SELL";
  price: number;
  quantity: number;
};

export type WritebackPayload = {
  generatedAt: string;
  dryRun: boolean;
  channel: string;
  signals: WritebackSignal[];
  note?: string;
};

export type WritebackResponse = {
  ok: boolean;
  writeback?: WritebackPayload;
  error?: string;
};

const NEUTRAL_BORDER = "rgba(148,163,184,0.2)";

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

function yuan(v: number): string {
  return `¥${v.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function sideTone(side: string): "up" | "down" {
  return side === "BUY" ? "up" : "down";
}

/* ------------------------------ 主视图 ------------------------------ */
export function WritebackView() {
  const [writeback, setWriteback] = useState<WritebackPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    let alive = true;
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/writeback-signals");
        const json = (await res.json()) as WritebackResponse;
        if (!alive) return;
        if (json.ok && json.writeback) setWriteback(json.writeback);
        else setError(json.error || "暂时无法读取回写结果");
      } catch {
        if (alive) setError("暂时无法读取回写结果");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    const timer = window.setTimeout(() => {
      cleanup = load();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      cleanup?.();
    };
  }, [load]);

  if (loading) {
    return (
      <div className="loading-state">
        <Spinner /> 正在加载回写结果…
      </div>
    );
  }
  if (error || !writeback) {
    return (
      <Banner tone="warn" title="暂无回写数据">
        {error || "请先在本地运行 trading_agent 生成候选回写信号并推送。"}
      </Banner>
    );
  }

  const totalAmount = writeback.signals.reduce(
    (sum, s) => sum + s.price * s.quantity,
    0,
  );

  return (
    <div className="writeback-view" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <SectionHeader
        eyebrow="交易 Agent · 回写"
        title="回写结果"
        subtitle={`生成于 ${writeback.generatedAt} ｜ 候选信号 ${writeback.signals.length} 笔`}
        desc="由 trading_agent 引擎生成的候选回写信号（当前为模拟回写 dry-run）。"
      />

      {writeback.dryRun ? (
        <Banner tone="warn" title="当前为模拟回写（dry-run）">
          本环境的 tdx-connector 仅暴露查询工具，未提供下单接口，因此信号暂未真实写入券商。
          待接入带下单能力的券商 MCP 后，可切换为真实回写。
        </Banner>
      ) : (
        <Banner tone="success" title="已真实回写">
          信号已推送至券商执行通道。
        </Banner>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 12,
        }}
      >
        <div
          style={{
            border: `1px solid ${NEUTRAL_BORDER}`,
            borderRadius: 10,
            padding: "12px 14px",
          }}
        >
          <div style={{ fontSize: 12, color: "#64748b" }}>候选信号</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{writeback.signals.length} 笔</div>
        </div>
        <div
          style={{
            border: `1px solid ${NEUTRAL_BORDER}`,
            borderRadius: 10,
            padding: "12px 14px",
          }}
        >
          <div style={{ fontSize: 12, color: "#64748b" }}>预估金额合计</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{yuan(totalAmount)}</div>
        </div>
        <div
          style={{
            border: `1px solid ${NEUTRAL_BORDER}`,
            borderRadius: 10,
            padding: "12px 14px",
          }}
        >
          <div style={{ fontSize: 12, color: "#64748b" }}>回写状态</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{writeback.dryRun ? "模拟" : "已执行"}</div>
        </div>
      </div>

      <Card>
        <CardHeader title="候选回写信号" desc="引擎产出的待回写委托（按最新收盘推导）。" />
        {writeback.signals.length === 0 ? (
          <Hint>本次运行未产生候选回写信号。</Hint>
        ) : (
          <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle()}>代码</th>
                <th style={thStyle()}>名称</th>
                <th style={thStyle()}>方向</th>
                <th style={thStyle()}>价格</th>
                <th style={thStyle()}>数量</th>
                <th style={thStyle()}>金额</th>
              </tr>
            </thead>
            <tbody>
              {writeback.signals.map((s, i) => (
                <tr key={`${s.code}-${i}`}>
                  <td style={tdStyle()}>{s.code}</td>
                  <td style={tdStyle()}>{s.name}</td>
                  <td style={tdStyle()}>
                    <Tag tone={sideTone(s.side)}>{s.side === "BUY" ? "买入" : "卖出"}</Tag>
                  </td>
                  <td style={tdStyle()}>{yuan(s.price)}</td>
                  <td style={tdStyle()}>{s.quantity}</td>
                  <td style={tdStyle()}>{yuan(s.price * s.quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Card>

      <Hint>
        回写通道：{writeback.channel}
        {writeback.note ? ` ｜ ${writeback.note}` : ""}
      </Hint>
    </div>
  );
}
