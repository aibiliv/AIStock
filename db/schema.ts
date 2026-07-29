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
  quantity: integer("quantity").notNull(),
  tradeDate: text("trade_date").notNull(),
  reason: text("reason").notNull(),
  maxLossCents: integer("max_loss_cents"),
  feeCents: integer("fee_cents").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const watchItems = sqliteTable("watch_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  symbol: text("symbol").notNull().unique(),
  name: text("name").notNull(),
  note: text("note").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const alertRules = sqliteTable("alert_rules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  type: text("type", { enum: ["止损", "止盈一", "止盈二"] }).notNull(),
  targetPriceCents: integer("target_price_cents").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  acknowledgedAt: text("acknowledged_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const reviews = sqliteTable("reviews", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  buyReason: text("buy_reason").notNull(),
  sellReason: text("sell_reason").notNull(),
  followedPlan: integer("followed_plan", { mode: "boolean" }).notNull(),
  lesson: text("lesson").notNull(),
  resultCents: integer("result_cents").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
