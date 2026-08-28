import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data", "familyoffice.db");

let db: Database.Database;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initSchema(db);
  }
  return db;
}

function initSchema(db: Database.Database) {
  // Migration: older databases created the accounts table without the 'loan'
  // type in its CHECK constraint. SQLite can't alter a CHECK, so rebuild.
  const accountsDef = db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='accounts'"
    )
    .get() as { sql: string } | undefined;
  if (accountsDef && !accountsDef.sql.includes("'loan'")) {
    db.pragma("foreign_keys = OFF");
    db.transaction(() => {
      db.exec(`
        CREATE TABLE accounts_new (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('bank','brokerage','super','property','crypto','loan','other')),
          owner TEXT NOT NULL CHECK(owner IN ('person1','person2','joint')),
          institution TEXT,
          currency TEXT DEFAULT 'AUD',
          notes TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        INSERT INTO accounts_new SELECT * FROM accounts;
        DROP TABLE accounts;
        ALTER TABLE accounts_new RENAME TO accounts;
      `);
    })();
    db.pragma("foreign_keys = ON");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('bank','brokerage','super','property','crypto','loan','other')),
      owner TEXT NOT NULL CHECK(owner IN ('person1','person2','joint')),
      institution TEXT,
      currency TEXT DEFAULT 'AUD',
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS balances (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      balance REAL NOT NULL,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT NOT NULL,
      category TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      notes TEXT,
      uploaded_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL CHECK(type IN ('income','expense')),
      color TEXT DEFAULT '#2E8B6E'
    );

    CREATE TABLE IF NOT EXISTS holdings (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      ticker TEXT NOT NULL,
      name TEXT,
      units REAL NOT NULL,
      cost_basis REAL NOT NULL DEFAULT 0,
      currency TEXT DEFAULT 'AUD',
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS price_cache (
      ticker TEXT PRIMARY KEY,
      price REAL NOT NULL,
      currency TEXT DEFAULT 'AUD',
      change_percent REAL,
      day_high REAL,
      day_low REAL,
      market_cap REAL,
      dividend_yield REAL,
      annual_dividend REAL,
      name TEXT,
      exchange TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      ticker TEXT NOT NULL,
      side TEXT NOT NULL CHECK(side IN ('buy','sell')),
      units REAL NOT NULL,
      price REAL NOT NULL,
      fees REAL NOT NULL DEFAULT 0,
      trade_date TEXT NOT NULL,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dividends (
      id TEXT PRIMARY KEY,
      holding_id TEXT NOT NULL REFERENCES holdings(id) ON DELETE CASCADE,
      ticker TEXT NOT NULL,
      ex_date TEXT NOT NULL,
      pay_date TEXT,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'AUD',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_prefs (
      user_id TEXT PRIMARY KEY,
      prefs TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL UNIQUE,
      total_net_worth REAL NOT NULL,
      total_assets REAL NOT NULL,
      total_liabilities REAL NOT NULL,
      holdings_value REAL NOT NULL,
      person1_total REAL NOT NULL DEFAULT 0,
      person2_total REAL NOT NULL DEFAULT 0,
      joint_total REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Loan metadata columns, added after the original release.
  for (const col of [
    "interest_rate REAL",
    "repayment_amount REAL",
    "redraw_available REAL",
  ]) {
    try {
      db.exec(`ALTER TABLE accounts ADD COLUMN ${col}`);
    } catch {
      // Column already exists.
    }
  }

  // Per-holding ownership. `owner` is a legacy single-owner override; `pct_p1`
  // is the proportional share owned by person1 (0-100), the remainder person2.
  // When both are null the holding inherits its account's owner.
  for (const col of ["owner TEXT", "pct_p1 REAL"]) {
    try {
      db.exec(`ALTER TABLE holdings ADD COLUMN ${col}`);
    } catch {
      // Column already exists.
    }
  }

  // The legacy per-holding `owner` override is no longer honoured: ownership now
  // resolves from pct_p1 (explicit share) or the account's owner. Stale values
  // in this column used to make the dashboard cards disagree with the drill-down
  // breakdown, so clear it once. pct_p1 (the real proportional share) is kept.
  try {
    db.exec("UPDATE holdings SET owner = NULL WHERE owner IS NOT NULL");
  } catch {
    // Column may not exist on very old schemas; ignore.
  }

  // Superannuation configuration. A super account grows two ways: its unit
  // price moves (investment performance) and estimated contributions buy more
  // units each pay cycle. Keeping this per-account config separate from the
  // generic accounts row avoids widening that table for a single account type.
  db.exec(`
    CREATE TABLE IF NOT EXISTS super_config (
      account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      fund_name TEXT,
      option_name TEXT,
      price_source TEXT NOT NULL DEFAULT 'proxy',
      unit_price REAL,
      unit_price_date TEXT,
      units REAL,
      fee_annual REAL DEFAULT 0.001,
      basket TEXT,
      basket_base TEXT,
      feed_url TEXT,
      feed_path TEXT,
      contrib_method TEXT DEFAULT 'sg',
      salary REAL,
      sg_rate REAL DEFAULT 0.12,
      extra_per_period REAL DEFAULT 0,
      pay_frequency TEXT DEFAULT 'fortnightly',
      contrib_tax REAL DEFAULT 0.15,
      last_contrib_date TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS super_price_history (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      unit_price REAL NOT NULL,
      units REAL NOT NULL,
      value REAL NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(account_id, date)
    );
  `);

  const catCount = db.prepare("SELECT COUNT(*) as count FROM categories").get() as { count: number };
  if (catCount.count === 0) {
    const insert = db.prepare("INSERT INTO categories (id, name, type, color) VALUES (?, ?, ?, ?)");
    const defaults = [
      ["cat_1", "Salary", "income", "#2E8B6E"],
      ["cat_2", "Dividends", "income", "#1A5C4A"],
      ["cat_3", "Rent Income", "income", "#3DA67E"],
      ["cat_4", "Housing", "expense", "#C44E52"],
      ["cat_5", "Groceries", "expense", "#DD8452"],
      ["cat_6", "Transport", "expense", "#937DC2"],
      ["cat_7", "Utilities", "expense", "#4C72B0"],
      ["cat_8", "Insurance", "expense", "#8C8C8C"],
      ["cat_9", "Dining", "expense", "#CCB974"],
      ["cat_10", "Entertainment", "expense", "#64B5CD"],
      ["cat_11", "Health", "expense", "#DA8BC3"],
      ["cat_12", "Education", "expense", "#8172B2"],
      ["cat_13", "Shopping", "expense", "#C49C94"],
      ["cat_14", "Travel", "expense", "#55A868"],
      ["cat_15", "Subscriptions", "expense", "#B07AA1"],
      ["cat_16", "Other", "expense", "#8A8578"],
    ];
    const batch = db.transaction(() => {
      for (const [id, name, type, color] of defaults) {
        insert.run(id, name, type, color);
      }
    });
    batch();
  }
}

export default getDb;
