"use client";

import { useState, useEffect, useCallback } from "react";

/* ----------------------------- 类型 ----------------------------- */
export type ScreenerOverrides = {
  // 策略预设（配方名：breakout / ma_golden / macd_cross）
  preset?: string;
  // 板块
  boards?: string[];
  // ST
  st_filter?: "all" | "include_st" | "exclude_st";
  // 流通市值（亿元）
  mcap_min?: number;
  mcap_max?: number;
  // 选股数量
  top_n?: number;
  // 行业分散
  max_per_sector?: number;
  // 因子权重
  w_momentum?: number;
  w_value?: number;
  w_liquidity?: number;
  w_rsi?: number;
  w_macd?: number;
  w_trend?: number;
  w_size?: number;
  w_quality?: number;
  // 阈值 / 参数
  momentum_window?: number;
  max_pe_ttm?: number;
  max_pb?: number;
  min_turnover_pct?: number;
  use_breakout_filter?: boolean;
  breakout_window?: number;
  fast_ma?: number;
  slow_ma?: number;
  macd_fast?: number;
  macd_slow?: number;
  macd_signal?: number;
  // 市场
  market_enable?: boolean;
};

/** 经典短线策略预设（与 trading_agent/strategy/presets.py 保持同步） */
export const STRATEGY_PRESETS: {
  key: string;
  label: string;
  desc: string;
  overrides: Partial<ScreenerOverrides>;
}[] = [
  {
    key: "breakout",
    label: "放量突破",
    desc: "强调动量 + 量能，要求活跃换手，捕捉横盘后放量突破前高。",
    overrides: {
      w_momentum: 0.40, w_liquidity: 0.22, w_trend: 0.16, w_rsi: 0.10,
      w_macd: 0.08, w_value: 0.02, w_size: 0.02, w_quality: 0.00,
      momentum_window: 20, min_turnover_pct: 1.0,
      use_breakout_filter: true, breakout_window: 20,
    },
  },
  {
    key: "ma_golden",
    label: "均线多头金叉",
    desc: "趋势跟随：重趋势 + 动量，快/慢均线 5/10 金叉确认。",
    overrides: {
      w_trend: 0.38, w_momentum: 0.26, w_liquidity: 0.14, w_rsi: 0.12,
      w_macd: 0.06, w_value: 0.02, w_size: 0.02, w_quality: 0.00,
      fast_ma: 5, slow_ma: 10, min_turnover_pct: 0.30,
    },
  },
  {
    key: "macd_cross",
    label: "MACD 金叉",
    desc: "动能反转：重 MACD 动能 + 趋势，捕捉 DIF 上穿 DEA。",
    overrides: {
      w_macd: 0.40, w_trend: 0.24, w_momentum: 0.18, w_rsi: 0.10,
      w_liquidity: 0.06, w_value: 0.02, w_size: 0.00, w_quality: 0.00,
      macd_fast: 12, macd_slow: 26, macd_signal: 9, min_turnover_pct: 0.30,
    },
  },
  // --- 激进策略 ---
  {
    key: "momentum_chase",
    label: "强势追涨",
    desc: "激进：极高动量权重，放开 PE/PB 限制，高换手门槛，精选 4 只。追涨不恐高。",
    overrides: {
      w_momentum: 0.50, w_liquidity: 0.22, w_trend: 0.14, w_rsi: 0.08,
      w_macd: 0.06, w_value: 0.00, w_size: 0.00, w_quality: 0.00,
      momentum_window: 10, max_pe_ttm: 10000, max_pb: 1000,
      min_turnover_pct: 2.0, top_n: 4,
      use_breakout_filter: true, breakout_window: 10,
    },
  },
  {
    key: "bottom_reversal",
    label: "超跌反弹",
    desc: "激进：重 RSI 低位 + MACD 反转，筛超跌后动能回暖标的，PE/PB 放宽，精选 5 只。",
    overrides: {
      w_rsi: 0.38, w_macd: 0.28, w_momentum: 0.16, w_liquidity: 0.08,
      w_trend: 0.06, w_value: 0.04, w_size: 0.00, w_quality: 0.00,
      momentum_window: 10, max_pe_ttm: 500, max_pb: 50,
      min_turnover_pct: 0.50, top_n: 5,
      use_breakout_filter: false,
    },
  },
  {
    key: "hot_theme",
    label: "题材热点追踪",
    desc: "激进：流动性为王 + 量能，不限 PE/PB，极高换手门槛，每板块只取 1 只，纯交易驱动。",
    overrides: {
      w_liquidity: 0.40, w_momentum: 0.25, w_macd: 0.15, w_trend: 0.12,
      w_rsi: 0.06, w_value: 0.02, w_size: 0.00, w_quality: 0.00,
      macd_fast: 6, macd_slow: 13, macd_signal: 5,
      max_pe_ttm: 10000, max_pb: 1000,
      min_turnover_pct: 3.0, top_n: 3, max_per_sector: 1,
      use_breakout_filter: false,
    },
  },
  // --- 游资风格 ---
  {
    key: "youzi",
    label: "游资风格",
    desc: "游资超短打法近似：超短周期强动量(8日) + 高换手量能驱动 + 不恐高(放开估值) + 短周期突破确认。捕捉游资控盘、放量拉升的弹性标的。",
    overrides: {
      w_momentum: 0.42, w_liquidity: 0.28, w_trend: 0.14, w_rsi: 0.08,
      w_macd: 0.08, w_value: 0.00, w_size: 0.00, w_quality: 0.00,
      momentum_window: 8, max_pe_ttm: 10000, max_pb: 1000,
      min_turnover_pct: 1.8, top_n: 5, st_filter: "exclude_st",
      use_breakout_filter: true, breakout_window: 12,
    },
  },
];

/** 默认值（与 config.py ScreenerConfig 默认值对齐） */
const DEFAULTS: Required<ScreenerOverrides> = {
  preset: "",
  boards: ["main", "cyb", "kc", "bj"],
  st_filter: "exclude_st",
  mcap_min: 0,
  mcap_max: 10000,
  top_n: 8,
  max_per_sector: 2,
  w_momentum: 0.30,
  w_value: 0.18,
  w_liquidity: 0.08,
  w_rsi: 0.12,
  w_macd: 0.12,
  w_trend: 0.16,
  w_size: 0.04,
  w_quality: 0.06,
  momentum_window: 20,
  max_pe_ttm: 200,
  max_pb: 20,
  min_turnover_pct: 0.15,
  use_breakout_filter: true,
  breakout_window: 20,
  fast_ma: 5,
  slow_ma: 20,
  macd_fast: 12,
  macd_slow: 26,
  macd_signal: 9,
  market_enable: true,
};

/* ----------------------------- 嵌套/扁平互转 -----------------------------
 * 云端存储与本地 pull_cloud_config.py 使用「嵌套结构」(screener/market/signal/optim)，
 * 与 trading_agent/config.py 的 _FLAT_MAP 对应；前端表单是「扁平结构」(ScreenerOverrides)。
 * 这里做双向转换，保证网页保存 != 本地拉取的数据契约一致。
 */
function toNested(ov: ScreenerOverrides): Record<string, unknown> {
  const screener: Record<string, unknown> = {};
  const market: Record<string, unknown> = {};
  const signal: Record<string, unknown> = {};

  const copy = (dst: Record<string, unknown>, key: keyof ScreenerOverrides) => {
    if (ov[key] !== undefined) dst[key as string] = ov[key];
  };

  // screener 节（字段名与扁平键一致）
  ([
    "top_n", "max_per_sector", "momentum_window", "w_momentum", "w_value",
    "w_liquidity", "w_rsi", "w_macd", "w_trend", "w_size", "w_quality",
    "min_turnover_pct", "max_pe_ttm", "max_pb", "boards", "st_filter",
    "mcap_min", "mcap_max",
  ] as (keyof ScreenerOverrides)[]).forEach((k) => copy(screener, k));

  // market 节（enable -> market_enable）
  if (ov.market_enable !== undefined) market["enable"] = ov.market_enable;

  // signal 节
  (["fast_ma", "slow_ma", "use_breakout_filter", "breakout_window"] as (keyof ScreenerOverrides)[]).forEach((k) => copy(signal, k));

  return {
    screener,
    ...(Object.keys(market).length ? { market } : {}),
    ...(Object.keys(signal).length ? { signal } : {}),
    optim: { enabled: true },
  };
}

function fromNested(cfg: Record<string, unknown>): Partial<ScreenerOverrides> {
  const out: Partial<ScreenerOverrides> = {};
  const s = (cfg["screener"] as Record<string, unknown>) || {};
  const m = (cfg["market"] as Record<string, unknown>) || {};
  const sig = (cfg["signal"] as Record<string, unknown>) || {};

  ([
    "top_n", "max_per_sector", "momentum_window", "w_momentum", "w_value",
    "w_liquidity", "w_rsi", "w_macd", "w_trend", "w_size", "w_quality",
    "min_turnover_pct", "max_pe_ttm", "max_pb", "boards", "st_filter",
    "mcap_min", "mcap_max",
  ] as (keyof ScreenerOverrides)[]).forEach((k) => {
    if (k in s) (out as Record<string, unknown>)[k] = s[k];
  });
  if ("enable" in m) out.market_enable = Boolean(m["enable"]);
  (["fast_ma", "slow_ma", "use_breakout_filter", "breakout_window"] as (keyof ScreenerOverrides)[]).forEach((k) => {
    if (k in sig) (out as Record<string, unknown>)[k] = sig[k];
  });
  return out;
}

const BOARD_OPTIONS = [
  { key: "main", label: "主板", desc: "60/00 开头" },
  { key: "cyb", label: "创业板", desc: "300 开头" },
  { key: "kc", label: "科创板", desc: "688 开头" },
  { key: "bj", label: "北交所", desc: "8/4 开头" },
] as const;

const ST_OPTIONS = [
  { key: "all", label: "不选 = 全A" },
  { key: "include_st", label: "包含ST" },
  { key: "exclude_st", label: "仅非ST" },
] as const;

/* ----------------------------- 样式 ----------------------------- */
/* 全部样式见 globals.css 的 .screener-* 系列，统一使用设计令牌 */

/* ----------------------------- 子组件 ----------------------------- */
function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="screener-check">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

function Radio({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="screener-check">
      <input type="radio" checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}

function NumberInput({
  value,
  onChange,
  placeholder,
  min = 0,
  step,
}: {
  value: number | undefined;
  onChange: (v: number) => void;
  placeholder?: string;
  min?: number;
  step?: number;
}) {
  return (
    <input
      className="screener-input"
      type="number"
      value={value ?? ""}
      placeholder={placeholder}
      min={min}
      step={step ?? 1}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : 0)}
    />
  );
}

function SliderRow({
  label,
  value,
  defaultValue,
  onChange,
  step = 0.01,
  min = 0,
  max = 1,
  displayMultiplier = 1,
}: {
  label: string;
  value: number;
  defaultValue: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  displayMultiplier?: number;
}) {
  const displayVal = value * displayMultiplier;
  const isDefault = Math.abs(value - defaultValue) < 0.001;
  return (
    <div className="screener-slider">
      <span className="screener-slider__label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className={`screener-slider__val ${isDefault ? "is-default" : "is-custom"}`}>
        {displayVal.toFixed(displayMultiplier === 1 ? 2 : 2)}
      </span>
    </div>
  );
}

/* ----------------------------- 主组件 ----------------------------- */
export function ScreenerConfigPanel({
  onRun,
  busy,
}: {
  onRun: (overrides: ScreenerOverrides) => Promise<void>;
  busy: boolean;
}) {
  const [ov, setOv] = useState<ScreenerOverrides>({ ...DEFAULTS });
  const [showWeights, setShowWeights] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<string>("");

  // 挂载时拉取云端持久配置作为默认，使网页与 CLI 共用同一份持久配置
  useEffect(() => {
    let cancelled = false;
    fetch("/api/strategy-scan/config")
      .then((r) => r.json() as { ok?: boolean; config?: Record<string, unknown> })
      .then((data) => {
        if (cancelled || !data?.ok || !data?.config) return;
        const cfg = fromNested(data.config as Record<string, unknown>);
        setOv((prev) => ({ ...DEFAULTS, ...prev, ...cfg }));
      })
      .catch(() => {
        /* 读取失败则保留 DEFAULTS */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 保存当前配置到云端（POST /api/strategy-scan/config）
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const saveConfig = useCallback(async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch("/api/strategy-scan/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: toNested(ov) }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (data?.ok) {
        setSaveMsg({ ok: true, text: "已保存到云端，本地拉取后将生效" });
      } else {
        setSaveMsg({ ok: false, text: data?.error || "保存失败" });
      }
    } catch (e) {
      setSaveMsg({ ok: false, text: `保存失败: ${String(e)}` });
    } finally {
      setSaving(false);
    }
  }, [ov]);

  const set = useCallback(<K extends keyof ScreenerOverrides>(k: K, v: ScreenerOverrides[K]) => {
    setOv((prev) => ({ ...prev, [k]: v }));
  }, []);

  const reset = useCallback(() => {
    setOv({ ...DEFAULTS });
    setSelectedPreset("");
  }, []);

  /** 套用策略预设：把配方灌入表单作为基线，之后仍可手动微调 */
  const applyPreset = useCallback((key: string) => {
    setSelectedPreset(key);
    if (!key) {
      setOv({ ...DEFAULTS });
      return;
    }
    const p = STRATEGY_PRESETS.find((x) => x.key === key);
    if (p) {
      setOv({ ...DEFAULTS, ...p.overrides, preset: key });
    }
  }, []);

  /** 切换板块选中状态 */
  const toggleBoard = useCallback((key: string) => {
    setOv((prev) => {
      const list = [...(prev.boards || [])];
      const idx = list.indexOf(key);
      if (idx >= 0) list.splice(idx, 1);
      else list.push(key);
      return { ...prev, boards: list };
    });
  }, []);

  /** 构建已应用条件的摘要标签 */
  const summaryTags: string[] = [];
  const activeBoards = ov.boards || [];
  if (activeBoards.length > 0 && activeBoards.length < 4) {
    const labels = activeBoards.map((b) => BOARD_OPTIONS.find((o) => o.key === b)?.label || b);
    summaryTags.push(`板块: ${labels.join(",")}`);
  }
  if ((ov.st_filter || "exclude_st") !== "all") {
    summaryTags.push(ov.st_filter === "exclude_st" ? "仅非ST" : "包含ST");
  }
  if ((ov.mcap_min || 0) > 0 || ((ov.mcap_max || 10000) < 10000)) {
    summaryTags.push(`市值(亿): ≥${ov.mcap_min || 0} ≤${ov.mcap_max || 10000}`);
  }
  if (selectedPreset) {
    const p = STRATEGY_PRESETS.find((x) => x.key === selectedPreset);
    if (p) summaryTags.push(`预设:${p.label}`);
  }

  // 检查权重是否有非默认值
  const weightKeys: (keyof ScreenerOverrides)[] = [
    "w_momentum", "w_value", "w_liquidity", "w_rsi", "w_macd", "w_trend", "w_size", "w_quality",
  ];
  const hasCustomWeights = weightKeys.some(
    (k) => {
      const v = ov[k];
      const d = DEFAULTS[k];
      return typeof v === "number" && typeof d === "number" && Math.abs(v - d) > 0.001;
    },
  );

  return (
    <div className="screener-panel">
      {/* 标题行 */}
      <div className="screener-panel__head">
        <h3 className="screener-panel__title">选股前置条件</h3>
        <span className="screener-muted">让扫描更有针对性</span>
      </div>

      {/* 策略预设下拉框 */}
      <div className="screener-preset-row">
        <div className="screener-preset-field">
          <span className="screener-field-label">策略预设</span>
          <select
            className="screener-select"
            value={selectedPreset}
            onChange={(e) => applyPreset(e.target.value)}
          >
            <option value="">请选择策略预设</option>
            {STRATEGY_PRESETS.map((preset) => (
              <option key={preset.key} value={preset.key}>{preset.label}</option>
            ))}
          </select>
        </div>
        {STRATEGY_PRESETS.find((p) => p.key === selectedPreset) && (
          <span className="screener-muted screener-preset-desc">
            {STRATEGY_PRESETS.find((p) => p.key === selectedPreset)!.desc}
          </span>
        )}
      </div>

      {/* 第一行：板块 + ST + 市值 —— 移动端自适应堆叠 */}
      <div className="screener-row">
        {/* 板块 */}
        <div>
          <div className="screener-field-label">板块 / 市场</div>
          <div className="screener-checks">
            {BOARD_OPTIONS.map((b) => (
              <Checkbox
                key={b.key}
                label={b.label}
                checked={activeBoards.includes(b.key)}
                onChange={() => toggleBoard(b.key)}
              />
            ))}
            <span className="screener-muted screener-hint">不选 = 全A</span>
          </div>
        </div>

        {/* ST 股 */}
        <div>
          <div className="screener-field-label">ST 股</div>
          <div className="screener-checks">
            {ST_OPTIONS.map((s) => (
              <Radio
                key={s.key}
                label={s.label}
                checked={(ov.st_filter || DEFAULTS.st_filter) === s.key}
                onChange={() => set("st_filter", s.key as ScreenerOverrides["st_filter"])}
              />
            ))}
          </div>
        </div>

        {/* 流通市值 */}
        <div>
          <div className="screener-field-label">流通市值（亿元）</div>
          <div className="screener-mcap">
            <NumberInput
              value={ov.mcap_min}
              onChange={(v) => set("mcap_min", v)}
              placeholder="不限"
              min={0}
            />
            <span className="screener-divider">—</span>
            <NumberInput
              value={ov.mcap_max === 10000 ? undefined : ov.mcap_max}
              onChange={(v) => set("mcap_max", v || 10000)}
              placeholder="不限"
              min={0}
            />
          </div>
        </div>
      </div>

      {/* 操作按钮行 —— 移动端自适应 */}
      <div className="screener-actions">
        <div className="screener-buttons">
          <button
            type="button"
            className="screener-btn screener-btn--primary"
            disabled={busy}
            onClick={() => onRun(ov)}
          >
            {busy ? "扫描中…" : "扫描"}
          </button>
          <button
            type="button"
            className="screener-btn screener-btn--primary"
            disabled={saving}
            onClick={saveConfig}
          >
            {saving ? "保存中…" : "保存配置"}
          </button>
          <button type="button" className="screener-btn screener-btn--ghost" onClick={reset}>
            重置
          </button>
          {saveMsg && (
            <span className={`screener-savemsg ${saveMsg.ok ? "is-ok" : "is-error"}`}>
              {saveMsg.text}
            </span>
          )}
        </div>
        {/* 已应用摘要 + 权量标签：独立一行，移动端不挤在按钮旁 */}
        {(summaryTags.length > 0 || hasCustomWeights) && (
          <div className="screener-tags">
            {summaryTags.length > 0 && (
              <>
                <span className="screener-muted">已应用：</span>
                {summaryTags.map((t, i) => (
                  <span key={i} className="screener-chip">{t}</span>
                ))}
              </>
            )}
            {hasCustomWeights && (
              <span className="screener-chip screener-chip--warn">自定义权重</span>
            )}
          </div>
        )}
      </div>

      {/* 可展开：因子权重 + 高级阈值 */}
      <div className="screener-weights">
        <button
          type="button"
          className="screener-toggle"
          onClick={() => setShowWeights((s) => !s)}
        >
          {showWeights ? "▼ 收起参数" : "▶ 因子权重 & 高级参数"}
        </button>

        {showWeights && (
          <div className="screener-weights-panel">
            {/* 因子权重滑块 */}
            <div className="screener-weights-sliders">
              <div className="screener-field-label screener-weights-title">因子权重（拖动调整，默认值灰色显示）</div>
              <SliderRow label="动量(风险调整)"     value={ov.w_momentum ?? DEFAULTS.w_momentum} defaultValue={DEFAULTS.w_momentum} onChange={(v) => set("w_momentum", v)} />
              <SliderRow label="估值(PE/PB)"       value={ov.w_value ?? DEFAULTS.w_value}         defaultValue={DEFAULTS.w_value}         onChange={(v) => set("w_value", v)} />
              <SliderRow label="趋势强度"           value={ov.w_trend ?? DEFAULTS.w_trend}         defaultValue={DEFAULTS.w_trend}         onChange={(v) => set("w_trend", v)} />
              <SliderRow label="RSI(14)"            value={ov.w_rsi ?? DEFAULTS.w_rsi}             defaultValue={DEFAULTS.w_rsi}             onChange={(v) => set("w_rsi", v)} />
              <SliderRow label="MACD 动能"          value={ov.w_macd ?? DEFAULTS.w_macd}           defaultValue={DEFAULTS.w_macd}           onChange={(v) => set("w_macd", v)} />
              <SliderRow label="流动性(换手)"       value={ov.w_liquidity ?? DEFAULTS.w_liquidity}  defaultValue={DEFAULTS.w_liquidity}  onChange={(v) => set("w_liquidity", v)} />
              <SliderRow label="规模(市值)"         value={ov.w_size ?? DEFAULTS.w_size}           defaultValue={DEFAULTS.w_size}           onChange={(v) => set("w_size", v)} />
              <SliderRow label="质量(ROE/股息)"     value={ov.w_quality ?? DEFAULTS.w_quality}      defaultValue={DEFAULTS.w_quality}      onChange={(v) => set("w_quality", v)} />
            </div>

            {/* 高级阈值 */}
            <div className="screener-advanced">
              <div>
                <div className="screener-field-label">选出数量 top_n</div>
                <NumberInput value={ov.top_n} onChange={(v) => set("top_n", v)} min={1} max={50} />
              </div>
              <div>
                <div className="screener-field-label">单行业上限</div>
                <NumberInput value={ov.max_per_sector} onChange={(v) => set("max_per_sector", v)} min={1} max={20} />
              </div>
              <div>
                <div className="screener-field-label">PE(TTM) 上限</div>
                <NumberInput value={ov.max_pe_ttm} onChange={(v) => set("max_pe_ttm", v)} min={0} step={10} />
              </div>
              <div>
                <div className="screener-field-label">PB 上限</div>
                <NumberInput value={ov.max_pb} onChange={(v) => set("max_pb", v)} min={0} step={1} />
              </div>
              <div>
                <div className="screener-field-label">换手率下限 %</div>
                <NumberInput value={ov.min_turnover_pct} onChange={(v) => set("min_turnover_pct", v)} min={0} step={0.05} />
              </div>
              <div>
                <div className="screener-field-label">市场状态过滤</div>
                <label className="screener-check">
                  <input
                    type="checkbox"
                    checked={ov.market_enable !== false}
                    onChange={(e) => set("market_enable", e.target.checked)}
                  />
                  启用（牛/熊自动调仓）
                </label>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
