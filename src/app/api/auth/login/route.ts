import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/auth";
import {
  clientIp,
  isLockedOut,
  recordFailure,
  recordSuccess,
} from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  const ip = clientIp(request);
  if (isLockedOut(ip)) {
    return NextResponse.json(
      { error: "Too many failed attempts. Try again in 15 minutes." },
      { status: 429 }
    );
  }

  const { name, password } = await request.json();

  if (!name || !password) {
    return NextResponse.json({ error: "Name and password required" }, { status: 400 });
  }

  const result = await authenticate(name, password);
  if (!result) {
    recordFailure(ip);
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  recordSuccess(ip);

  const response = NextResponse.json({ user: result.user });
  response.cookies.set("auth-token", result.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60,
    path: "/",
  });

  return response;
}
