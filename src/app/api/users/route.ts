import { NextResponse } from "next/server";

// Display names for the two owners, sourced from the login configuration.
export async function GET() {
  return NextResponse.json({
    person1: process.env.USER1_NAME || "Person 1",
    person2: process.env.USER2_NAME || "Person 2",
  });
}
