import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import {
  getProfile,
  setSetting,
  RISK_LEVELS,
  type Profile,
} from "@/lib/insights";

// Household profile: per-person birth month + income, and the household risk
// level / desired return and planned spend. These feed the Freedom Number and
// scenario projections.
export async function GET() {
  const db = getDb();
  return NextResponse.json({
    profile: getProfile(db),
    users: {
      person1: process.env.USER1_NAME || "Person 1",
      person2: process.env.USER2_NAME || "Person 2",
    },
    riskLevels: RISK_LEVELS,
  });
}

const YM = /^\d{4}-\d{2}$/;

export async function PUT(request: NextRequest) {
  const db = getDb();
  const body = await request.json().catch(() => ({}));
  const cur = getProfile(db);

  const num = (v: unknown, fallback: number | null): number | null => {
    if (v === null || v === "") return null;
    if (v === undefined) return fallback;
    const n = parseFloat(v as string);
    return isFinite(n) ? n : fallback;
  };
  const ym = (v: unknown, fallback: string | null): string | null => {
    if (v === undefined) return fallback;
    if (typeof v === "string" && YM.test(v)) return v;
    return null;
  };
  const person = (
    input: unknown,
    curP: { birth: string | null; income: number | null; sgRate: number | null }
  ) => {
    const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    return {
      birth: ym(o.birth, curP.birth),
      income: num(o.income, curP.income),
      sgRate: num(o.sgRate, curP.sgRate),
    };
  };

  const validRisk =
    typeof body.riskLevel === "string" && RISK_LEVELS.some((r) => r.key === body.riskLevel)
      ? body.riskLevel
      : body.riskLevel === null || body.riskLevel === ""
        ? null
        : cur.riskLevel;

  const next: Profile = {
    p1: person(body.p1, cur.p1),
    p2: person(body.p2, cur.p2),
    riskLevel: validRisk,
    desiredReturn: num(body.desiredReturn, cur.desiredReturn),
    annualSpend: num(body.annualSpend, cur.annualSpend),
  };

  setSetting(db, "profile", next);
  return NextResponse.json({ ok: true, profile: next });
}
