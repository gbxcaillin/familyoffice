import { NextRequest, NextResponse } from "next/server";
import { analyzeCsv, analyzePdfText } from "@/lib/import-detect";

export const runtime = "nodejs";

// Accepts an uploaded CSV or PDF, self-identifies the document, and returns a
// normalized preview routed to the right importer.
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

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
      result = analyzePdfText(parsed.text);
    } else {
      result = analyzeCsv(buf.toString("utf8"));
    }
  } catch (e) {
    return NextResponse.json(
      { error: `Could not read the file: ${(e as Error).message}` },
      { status: 400 }
    );
  }

  if (!result) {
    return NextResponse.json(
      {
        error:
          "Couldn't recognise this document. It may be an unsupported format — you can still import it by choosing a type manually if it's a CSV.",
      },
      { status: 422 }
    );
  }

  return NextResponse.json({ ...result, fileName: file.name });
}
