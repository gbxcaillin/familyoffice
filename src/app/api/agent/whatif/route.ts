import { NextRequest, NextResponse } from "next/server";
import { whatIfScenario, agentConfigured } from "@/lib/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Translate a plain-English "what if" into new FIRE scenario values. Returns the
// changed fields + an explanation; the client applies them to the sliders. No
// data is written.
export async function POST(request: NextRequest) {
  if (!agentConfigured()) {
    return NextResponse.json(
      { error: "Claude isn't set up yet — add CLAUDE_CODE_OAUTH_TOKEN to the server and restart." },
      { status: 503 }
    );
  }
  const body = await request.json().catch(() => ({}));
  const phrase = typeof body.phrase === "string" ? body.phrase.trim() : "";
  const scenario = body.scenario && typeof body.scenario === "object" ? body.scenario : {};
  if (!phrase) {
    return NextResponse.json({ error: "Describe a change to model." }, { status: 400 });
  }
  try {
    const result = await whatIfScenario(phrase, scenario);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
