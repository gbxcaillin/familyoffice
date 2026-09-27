import { NextRequest, NextResponse } from "next/server";
import { askMoney, agentConfigured, type AskTurn } from "@/lib/agent";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  // Lets the UI show a helpful setup notice instead of failing on first ask.
  return NextResponse.json({ configured: agentConfigured() });
}

export async function POST(request: NextRequest) {
  if (!agentConfigured()) {
    return NextResponse.json(
      {
        error:
          "The assistant isn't configured. Add ANTHROPIC_API_KEY to the server environment and restart.",
      },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) {
    return NextResponse.json({ error: "Ask a question." }, { status: 400 });
  }

  // Only keep the last few plain-text turns for follow-up context.
  const history: AskTurn[] = Array.isArray(body.history)
    ? body.history
        .filter(
          (t: unknown): t is AskTurn =>
            !!t &&
            typeof t === "object" &&
            (((t as AskTurn).role === "user") || ((t as AskTurn).role === "assistant")) &&
            typeof (t as AskTurn).content === "string"
        )
        .slice(-8)
    : [];

  try {
    const result = await askMoney(question, history);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Something went wrong.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
