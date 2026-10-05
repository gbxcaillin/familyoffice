import { NextRequest, NextResponse } from "next/server";
import {
  analyzeCsv,
  analyzePdfText,
  analyzeCsvAs,
  analyzePdfTextAs,
  type ImportKind,
} from "@/lib/import-detect";

export const runtime = "nodejs";

const KIND_LABEL: Record<ImportKind, string> = {
  holdings: "holdings",
  trades: "orders",
  transactions: "transactions",
};

// Accepts an uploaded CSV or PDF, self-identifies the document, and returns a
// normalized preview routed to the right importer. If a `kind` field is sent
// (manual override), it parses as that type instead of auto-detecting.
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  const forced = form.get("kind");
  const kind: ImportKind | null =
    forced === "holdings" || forced === "trades" || forced === "transactions"
      ? forced
      : null;

  const buf = Buffer.from(await file.arrayBuffer());
  const isPdf =
    file.name.toLowerCase().endsWith(".pdf") ||
    buf.slice(0, 5).toString("latin1") === "%PDF-";

  let result;
  try {
    if (isPdf) {
      // Import the parser directly to skip the package's debug harness.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pdfParse = ((await import("pdf-parse/lib/pdf-parse.js" as any)) as any)
        .default;
      const parsed = await pdfParse(buf);
      result = kind ? analyzePdfTextAs(parsed.text, kind) : analyzePdfText(parsed.text);
    } else {
      const text = buf.toString("utf8");
      result = kind ? analyzeCsvAs(text, kind) : analyzeCsv(text);
    }
  } catch (e) {
    return NextResponse.json(
      { error: `Could not read the file: ${(e as Error).message}` },
      { status: 400 }
    );
  }

  if (!result) {
    // A forced parse that still failed means the columns/rows didn't line up —
    // tell the user what that type needs. An auto-detect failure offers the
    // manual override (the UI renders type buttons on a 422).
    if (kind) {
      const need =
        kind === "holdings"
          ? "a ticker/code column and a units (or quantity) column"
          : kind === "trades"
            ? "date, ticker, side (buy/sell), units and price columns"
            : "date, description and amount (or debit/credit) columns";
      const extra = isPdf && kind !== "holdings"
        ? " Orders and transactions can't be read from a PDF — export a CSV instead."
        : "";
      return NextResponse.json(
        {
          error: `Couldn't read this file as ${KIND_LABEL[kind]}. That importer needs ${need}.${extra}`,
          canOverride: false,
        },
        { status: 422 }
      );
    }
    return NextResponse.json(
      {
        error:
          "Couldn't auto-identify this document. If you know what it is, choose a type below to import it anyway.",
        canOverride: true,
      },
      { status: 422 }
    );
  }

  return NextResponse.json({ ...result, fileName: file.name });
}
