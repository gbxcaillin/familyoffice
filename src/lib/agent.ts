import Anthropic from "@anthropic-ai/sdk";
import Database from "better-sqlite3";
import path from "path";

// ---------------------------------------------------------------------------
// "Ask your money" — a small tool-using agent that answers natural-language
// questions about the household finances by writing and running its own
// READ-ONLY SQL against the app's SQLite database.
//
// Safety model, in layers:
//   1. A dedicated connection opened readonly — SQLite itself rejects writes.
//   2. A statement guard — only a single SELECT / WITH … SELECT is allowed.
//   3. A hard row cap so a broad query can't blow the token budget.
// The model never touches the filesystem or shell; its only tool is run_sql.
// ---------------------------------------------------------------------------

const DB_PATH = path.join(process.cwd(), "data", "familyoffice.db");
const MODEL = process.env.AGENT_MODEL || "claude-sonnet-5";
const MAX_ROWS = 500;
const MAX_TURNS = 6;

let roDb: Database.Database | undefined;

// A separate, read-only handle. The main app connection stays read/write; this
// one physically cannot mutate the database even if the guard were bypassed.
function getReadonlyDb(): Database.Database {
  if (!roDb) {
    roDb = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    roDb.pragma("query_only = ON");
  }
  return roDb;
}

const FORBIDDEN =
  /\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum|reindex|truncate)\b/i;

function assertReadOnly(raw: string): string {
  const sql = raw.trim().replace(/;+\s*$/, "");
  if (!sql) throw new Error("Empty query.");
  if (sql.includes(";")) throw new Error("Only a single statement is allowed.");
  if (!/^(select|with)\b/i.test(sql)) throw new Error("Only SELECT queries are allowed.");
  if (FORBIDDEN.test(sql)) throw new Error("Only read-only SELECT queries are allowed.");
  return sql;
}

interface SqlResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
}

function runReadonlySql(raw: string): SqlResult {
  const sql = assertReadOnly(raw);
  const db = getReadonlyDb();
  const stmt = db.prepare(sql);
  const all = stmt.raw().all() as unknown[][];
  const columns = stmt.columns().map((c) => c.name);
  const truncated = all.length > MAX_ROWS;
  return {
    columns,
    rows: all.slice(0, MAX_ROWS),
    rowCount: all.length,
    truncated,
  };
}

// A compact, always-accurate schema summary built from the live database, plus
// curated notes so the model reads the data the way the app does.
function schemaSummary(): string {
  const db = getReadonlyDb();
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .all() as { name: string }[];
  const lines: string[] = [];
  for (const t of tables) {
    const cols = db.prepare(`PRAGMA table_info(${t.name})`).all() as {
      name: string;
      type: string;
    }[];
    lines.push(`${t.name}(${cols.map((c) => c.name).join(", ")})`);
  }
  return lines.join("\n");
}

const NOTES = `
Reading notes (how the app interprets this data):
- All amounts are in AUD unless a currency column says otherwise.
- accounts.type is one of bank, brokerage, super, property, crypto, loan, other.
  A 'loan' account is a liability (e.g. the mortgage); its balance is the amount owed.
- accounts.owner is person1, person2, or joint. person1 = Caillin, person2 = Kirra.
- transactions.amount: negative = money out (an expense), positive = money in (income).
  Use date >= date('now','start of month') for "this month"; SQLite date() functions work.
- balances holds point-in-time account balances over time (latest per account = current).
- holdings are share/ETF/crypto positions (units, cost_basis); price_cache has the latest
  price per ticker — join holdings.ticker = price_cache.ticker and multiply units * price
  for current market value. change_percent is the day move.
- snapshots is the daily net-worth history (total_net_worth, assets, liabilities, per-owner
  totals). Use it for trends over time.
- super_config / super_price_history cover superannuation balances and unit-price history.
- budgets is the planned monthly budget per category (monthly, essential=1/0). Actual spend
  comes from transactions, not this table.
- app_settings holds JSON blobs: key 'fire' = Freedom Number/FIRE assumptions
  (targetOverride is the $ target, includeHome, birthP1/birthP2 = birth months), key
  'profile' = per-person income/super/risk. Parse the JSON in the 'value' column mentally;
  you cannot use JSON functions reliably, so just read the value text.
`.trim();

function buildSystem(schema: string, today: string): string {
  return `You are the analyst for a private two-person Australian family-office net-worth dashboard (the users are Caillin and Kirra). You answer questions about their own finances.

You have ONE tool: run_sql, which runs a single read-only SELECT against their SQLite database and returns the rows. Query the database to ground every factual answer — never guess at figures. You may call run_sql several times to build up an answer (e.g. explore the schema, then compute).

Database tables and columns:
${schema}

${NOTES}

Answering style:
- Be concise and direct. Lead with the number, then a one-line explanation.
- Format money as AUD with thousands separators (e.g. $1,234,567). Round sensibly.
- If a question is ambiguous, make the most reasonable assumption and state it briefly.
- If the data needed isn't there, say so plainly rather than inventing it.
- Never run anything other than SELECT queries. You cannot change any data.
- Today's date is ${today}.`;
}

const TOOL: Anthropic.Tool = {
  name: "run_sql",
  description:
    "Run a single read-only SQL SELECT query against the family-office SQLite database and get the resulting rows back. Only SELECT / WITH…SELECT statements are permitted.",
  input_schema: {
    type: "object",
    properties: {
      sql: {
        type: "string",
        description: "A single SQLite SELECT statement (no trailing semicolon needed).",
      },
    },
    required: ["sql"],
  },
};

export interface AskTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AskResult {
  answer: string;
  queries: { sql: string; rowCount?: number; error?: string }[];
}

export function agentConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function askMoney(question: string, history: AskTurn[] = []): Promise<AskResult> {
  if (!agentConfigured()) {
    throw new Error(
      "The assistant isn't configured. Set ANTHROPIC_API_KEY in the server environment."
    );
  }

  const client = new Anthropic(); // reads ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL
  const system = buildSystem(schemaSummary(), new Date().toISOString().slice(0, 10));

  // Seed with prior plain-text turns so follow-up questions have context.
  const messages: Anthropic.MessageParam[] = [
    ...history
      .filter((t) => t.content?.trim())
      .map((t) => ({ role: t.role, content: t.content })),
    { role: "user" as const, content: question },
  ];

  const queries: AskResult["queries"] = [];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system,
      tools: [TOOL],
      messages,
    });

    if (resp.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: resp.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of resp.content) {
        if (block.type !== "tool_use" || block.name !== "run_sql") continue;
        const sql = String((block.input as { sql?: string })?.sql ?? "");
        try {
          const r = runReadonlySql(sql);
          queries.push({ sql, rowCount: r.rowCount });
          const payload = {
            columns: r.columns,
            rows: r.rows,
            rowCount: r.rowCount,
            note: r.truncated ? `Showing first ${MAX_ROWS} of ${r.rowCount} rows.` : undefined,
          };
          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify(payload),
          });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          queries.push({ sql, error: message });
          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: `Error: ${message}`,
            is_error: true,
          });
        }
      }
      messages.push({ role: "user", content: results });
      continue;
    }

    // Final answer.
    const answer = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return { answer: answer || "I couldn't find an answer to that.", queries };
  }

  return {
    answer:
      "That took more steps than I could complete in one go — try narrowing the question.",
    queries,
  };
}
