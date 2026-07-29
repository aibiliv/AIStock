import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

let schemaReady: Promise<void> | null = null;

export function getDb() {
  if (!env.DB) {
    throw new Error("数据库暂不可用");
  }
  return drizzle(env.DB, { schema });
}

export async function ensureSchema() {
  if (!env.DB) {
    throw new Error("数据库暂不可用");
  }
  if (schemaReady) {
    return schemaReady;
  }

  schemaReady = (async () => {
    const db = env.DB;
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS trade_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        side TEXT NOT NULL CHECK(side IN ('买入', '卖出')),
        price_cents INTEGER NOT NULL CHECK(price_cents > 0),
        quantity INTEGER NOT NULL CHECK(quantity > 0),
        trade_date TEXT NOT NULL,
        reason TEXT NOT NULL,
        max_loss_cents INTEGER,
        fee_cents INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS watch_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        symbol TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS alert_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('止损', '止盈一', '止盈二')),
        target_price_cents INTEGER NOT NULL CHECK(target_price_cents > 0),
        enabled INTEGER NOT NULL DEFAULT 1,
        acknowledged_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        buy_reason TEXT NOT NULL,
        sell_reason TEXT NOT NULL,
        followed_plan INTEGER NOT NULL,
        lesson TEXT NOT NULL,
        result_cents INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      db.prepare("CREATE INDEX IF NOT EXISTS trade_records_symbol_idx ON trade_records(symbol)"),
      db.prepare("CREATE INDEX IF NOT EXISTS alert_rules_symbol_idx ON alert_rules(symbol)"),
      db.prepare("CREATE INDEX IF NOT EXISTS reviews_symbol_idx ON reviews(symbol)"),
    ]);
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });

  return schemaReady;
}
