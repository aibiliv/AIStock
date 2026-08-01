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

async function addColumnIfMissing(table: string, column: string, definition: string) {
  const db = env.DB;
  const info = await db.prepare(`PRAGMA table_info(${table})`).all();
  const columns = info.results as Array<{ name?: string }>;
  if (columns.some((item) => item.name === column)) return;

  try {
    await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${definition}`).run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!message.toLowerCase().includes("duplicate column")) throw error;
  }
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
        price_millis INTEGER,
        price_ten_thousandths INTEGER,
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
      db.prepare(`CREATE TABLE IF NOT EXISTS watch_details (
        symbol TEXT PRIMARY KEY NOT NULL,
        condition_text TEXT NOT NULL DEFAULT '等待自己的买入条件',
        status TEXT NOT NULL DEFAULT '研究中',
        last_reviewed_at TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        condition_metric TEXT,
        condition_direction TEXT,
        condition_value REAL
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS alert_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('止损', '止盈一', '止盈二')),
        target_price_cents INTEGER NOT NULL CHECK(target_price_cents > 0),
        target_price_millis INTEGER,
        enabled INTEGER NOT NULL DEFAULT 1,
        acknowledged_at TEXT,
        triggered_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        cycle_end_trade_id INTEGER,
        buy_reason TEXT NOT NULL,
        sell_reason TEXT NOT NULL,
        followed_plan INTEGER NOT NULL,
        lesson TEXT NOT NULL,
        result_cents INTEGER NOT NULL DEFAULT 0,
        tags TEXT NOT NULL DEFAULT '[]',
        deviation_reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS analysis_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        price_cents INTEGER NOT NULL,
        price_millis INTEGER,
        market_time TEXT,
        source TEXT NOT NULL,
        mode TEXT NOT NULL,
        summary TEXT NOT NULL,
        report_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS announcement_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        title TEXT NOT NULL,
        source_url TEXT NOT NULL DEFAULT '',
        total_pages INTEGER NOT NULL DEFAULT 0,
        summary TEXT NOT NULL,
        risks_json TEXT NOT NULL DEFAULT '[]',
        mode TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS account_settings (
        id INTEGER PRIMARY KEY NOT NULL,
        initial_capital_cents INTEGER NOT NULL CHECK(initial_capital_cents > 0),
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS capital_flows (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        amount_cents INTEGER NOT NULL,
        flow_date TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS trading_preferences (
        id INTEGER PRIMARY KEY NOT NULL,
        risk_profile TEXT NOT NULL DEFAULT '平衡',
        max_loss_percent REAL NOT NULL DEFAULT 2,
        max_concentration_percent REAL NOT NULL DEFAULT 30,
        max_position_percent REAL NOT NULL DEFAULT 70,
        enforce_stop_loss INTEGER NOT NULL DEFAULT 1,
        discipline_note TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      db.prepare("CREATE INDEX IF NOT EXISTS trade_records_symbol_idx ON trade_records(symbol)"),
      db.prepare("CREATE INDEX IF NOT EXISTS alert_rules_symbol_idx ON alert_rules(symbol)"),
      db.prepare("CREATE INDEX IF NOT EXISTS reviews_symbol_idx ON reviews(symbol)"),
      db.prepare("CREATE INDEX IF NOT EXISTS analysis_reports_symbol_idx ON analysis_reports(symbol)"),
      db.prepare("CREATE INDEX IF NOT EXISTS announcement_notes_symbol_idx ON announcement_notes(symbol)"),
      db.prepare(`CREATE TABLE IF NOT EXISTS strategy_feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        verdict TEXT NOT NULL DEFAULT '有效',
        note TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'web',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      db.prepare("CREATE INDEX IF NOT EXISTS strategy_feedback_symbol_idx ON strategy_feedback(symbol)"),
    ]);
    await addColumnIfMissing("trade_records", "price_millis", "price_millis INTEGER");
    await addColumnIfMissing("trade_records", "price_ten_thousandths", "price_ten_thousandths INTEGER");
    await addColumnIfMissing("alert_rules", "target_price_millis", "target_price_millis INTEGER");
    await addColumnIfMissing("alert_rules", "triggered_at", "triggered_at TEXT");
    await addColumnIfMissing("watch_details", "condition_metric", "condition_metric TEXT");
    await addColumnIfMissing("watch_details", "condition_direction", "condition_direction TEXT");
    await addColumnIfMissing("watch_details", "condition_value", "condition_value REAL");
    await addColumnIfMissing("trade_records", "other_reason", "other_reason TEXT");
    await addColumnIfMissing("analysis_reports", "price_millis", "price_millis INTEGER");
    await addColumnIfMissing("reviews", "tags", "tags TEXT NOT NULL DEFAULT '[]'");
    await addColumnIfMissing("reviews", "deviation_reason", "deviation_reason TEXT NOT NULL DEFAULT ''");
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });

  return schemaReady;
}
