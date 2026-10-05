import { NextRequest, NextResponse } from "next/server";
import { parseImportFile, agentConfigured } from "@/lib/agent";
import {
  asxTicker,
  normalizeSide,
  parseDate,
  guessCategory,
  type ImportKind,
  type HoldingRow,
  type TradeRow,
  type TxnRow,
} from "@/lib/import-detect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function toNum(v: unknown): number | null {
  if (typeof v === "number") return isNaN(v) ? null : v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/[$,\s]/g, ""));
    return isNaN(n) ? null : n;
  }
  return null;
}
function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

// Normalise Claude's extracted rows into the same preview shape the app's own
// detectors produce, so the rest of the import flow (preview → bulk import) is
// unchanged.
export async function POST(request: NextRequest) {
  if (!agentConfigured()) {
    return NextResponse.json(
      {
        error:
          "Claude isn't set up yet — add CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`) to the server and restart.",
      },
      { status: 503 }
    );
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  const hintRaw = form.get("kind");
  const hint: ImportKind | undefined =
    hintRaw === "holdings" || hintRaw === "trades" || hintRaw === "transactions"
      ? hintRaw
      : undefined;

  const buf = Buffer.from(await file.arrayBuffer());
  const isPdf =
    file.name.toLowerCase().endsWith(".pdf") ||
    buf.slice(0, 5).toString("latin1") === "%PDF-";

  let text: string;
  try {
    if (isPdf) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pdfParse = ((await import("pdf-parse/lib/pdf-parse.js" as any)) as any).default;
      text = (await pdfParse(buf)).text;
    } else {
      text = buf.toString("utf8");
    }
  } catch (e) {
    return NextResponse.json(
      { error: `Could not read the file: ${(e as Error).message}` },
      { status: 400 }
    );
  }

  let parsed;
  try {
    parsed = await parseImportFile(text, { hint });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }

  const warnings = [
    "Read by Claude — check every row carefully before importing.",
    ...(parsed.note ? [parsed.note] : []),
  ];

  if (parsed.kind === "holdings") {
    const holdings: HoldingRow[] = [];
    for (const r of parsed.rows) {
      const ticker = str(r.ticker ?? r.code ?? r.symbol);
      const units = toNum(r.units ?? r.quantity ?? r.shares);
      if (!ticker || !units || units <= 0) continue;
      const price = toNum(r.price) ?? 0;
      const value = toNum(r.value) ?? (price ? price * units : 0);
      holdings.push({ ticker: asxTicker(ticker), name: str(r.name), units, price, value });
    }
    if (holdings.length === 0) {
      return NextResponse.json(
        { error: "Claude didn't find any holdings in this file." },
        { status: 422 }
      );
    }
    return NextResponse.json({
      kind: "holdings",
      source: "claude-parse",
      label: "Holdings (read by Claude)",
      holdings,
      cash: null,
      warnings,
      fileName: file.name,
    });
  }

  if (parsed.kind === "trades") {
    const trades: TradeRow[] = [];
    for (const r of parsed.rows) {
      const date = parseDate(str(r.trade_date ?? r.date));
      const ticker = str(r.ticker ?? r.code ?? r.symbol);
      const side = normalizeSide(str(r.side ?? r.type ?? r.action));
      const units = toNum(r.units ?? r.quantity ?? r.shares);
      const price = toNum(r.price ?? r.rate);
      if (!date || !ticker || !side || !units || price === null) continue;
      trades.push({
        trade_date: date,
        ticker: asxTicker(ticker),
        side,
        units,
        price,
        fees: toNum(r.fees) ?? 0,
      });
    }
    if (trades.length === 0) {
      return NextResponse.json(
        { error: "Claude didn't find any orders in this file." },
        { status: 422 }
      );
    }
    return NextResponse.json({
      kind: "trades",
      source: "claude-parse",
      label: "Orders (read by Claude)",
      trades,
      warnings,
      fileName: file.name,
    });
  }

  const txns: TxnRow[] = [];
  for (const r of parsed.rows) {
    const date = parseDate(str(r.date));
    const description = str(r.description ?? r.narrative ?? r.details);
    const amount = toNum(r.amount);
    if (!date || !description || amount === null) continue;
    txns.push({
      date,
      description,
      amount,
      category: str(r.category) || guessCategory(description, amount),
    });
  }
  if (txns.length === 0) {
    return NextResponse.json(
      { error: "Claude didn't find any transactions in this file." },
      { status: 422 }
    );
  }
  return NextResponse.json({
    kind: "transactions",
    source: "claude-parse",
    label: "Transactions (read by Claude)",
    transactions: txns,
    warnings,
    fileName: file.name,
  });
}
