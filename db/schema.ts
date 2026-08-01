import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Keep the original prototype table in the migration graph so existing data is
// never dropped when the new, validated tables are introduced.
export const legacyTrades = sqliteTable("trades", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  side: text("side").notNull(),
  price: real("price").notNull(),
  quantity: integer("quantity").notNull(),
  reason: text("reason").notNull(),
  plan: text("plan").notNull(),
  tradedAt: text("traded_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const tradeRecords = sqliteTable("trade_records", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  side: text("side", { enum: ["买入", "卖出"] }).notNull(),
  priceCents: integer("price_cents").notNull(),
  priceMillis: integer("price_millis"),
  priceTenThousandths: integer("price_ten_thousandths"),
  quantity: integer("quantity").notNull(),
  tradeDate: text("trade_date").notNull(),
  reason: text("reason").notNull(),
  maxLossCents: integer("max_loss_cents"),
  feeCents: integer("fee_cents").notNull().default(0),
  otherReason: text("other_reason"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const watchItems = sqliteTable("watch_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  symbol: text("symbol").notNull().unique(),
  name: text("name").notNull(),
  note: text("note").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const watchDetails = sqliteTable("watch_details", {
  symbol: text("symbol").primaryKey(),
  conditionText: text("condition_text").notNull().default("等待自己的买入条件"),
  status: text("status", { enum: ["研究中", "等待条件", "已买入", "暂停"] }).notNull().default("研究中"),
  lastReviewedAt: text("last_reviewed_at"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  conditionMetric: text("condition_metric"),
  conditionDirection: text("condition_direction"),
  conditionValue: real("condition_value"),
});

export const alertRules = sqliteTable("alert_rules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  type: text("type", { enum: ["止损", "止盈一", "止盈二"] }).notNull(),
  targetPriceCents: integer("target_price_cents").notNull(),
  targetPriceMillis: integer("target_price_millis"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  acknowledgedAt: text("acknowledged_at"),
  triggeredAt: text("triggered_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const reviews = sqliteTable("reviews", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  cycleEndTradeId: integer("cycle_end_trade_id"),
  buyReason: text("buy_reason").notNull(),
  sellReason: text("sell_reason").notNull(),
  followedPlan: integer("followed_plan", { mode: "boolean" }).notNull(),
  lesson: text("lesson").notNull(),
  resultCents: integer("result_cents").notNull().default(0),
  tags: text("tags").notNull().default("[]"),
  deviationReason: text("deviation_reason").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const analysisReports = sqliteTable("analysis_reports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  priceCents: integer("price_cents").notNull(),
  priceMillis: integer("price_millis"),
  marketTime: text("market_time"),
  source: text("source").notNull(),
  mode: text("mode", { enum: ["deepseek", "automatic"] }).notNull(),
  summary: text("summary").notNull(),
  reportJson: text("report_json").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const announcementNotes = sqliteTable("announcement_notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  title: text("title").notNull(),
  sourceUrl: text("source_url").notNull().default(""),
  totalPages: integer("total_pages").notNull().default(0),
  summary: text("summary").notNull(),
  risksJson: text("risks_json").notNull().default("[]"),
  mode: text("mode", { enum: ["deepseek", "automatic"] }).notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const accountSettings = sqliteTable("account_settings", {
  id: integer("id").primaryKey(),
  initialCapitalCents: integer("initial_capital_cents").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const capitalFlows = sqliteTable("capital_flows", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  amountCents: integer("amount_cents").notNull(),
  flowDate: text("flow_date").notNull(),
  note: text("note"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const tradingPreferences = sqliteTable("trading_preferences", {
  id: integer("id").primaryKey(),
  riskProfile: text("risk_profile", { enum: ["保守", "平衡", "激进"] }).notNull().default("平衡"),
  maxLossPercent: real("max_loss_percent").notNull().default(2),
  maxConcentrationPercent: real("max_concentration_percent").notNull().default(30),
  maxPositionPercent: real("max_position_percent").notNull().default(70),
  enforceStopLoss: integer("enforce_stop_loss", { mode: "boolean" }).notNull().default(true),
  disciplineNote: text("discipline_note").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// 用户反馈（对应架构图「用户 → 本项目 → 优化策略」闭环）
// 用户在「策略扫描」页对某只标的/某次信号给出有效/无效评价，供 optimizer 调整权重。
export const strategyFeedback = sqliteTable("strategy_feedback", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  symbol: text("symbol").notNull(),
  name: text("name").notNull().default(""),
  verdict: text("verdict", { enum: ["有效", "无效"] }).notNull().default("有效"),
  note: text("note").notNull().default(""),
  source: text("source").notNull().default("web"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
