// @ts-nocheck
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { q1, q2, q3, q4, q5, q6, q7, q8 } = body || {};
    if (!q1 || !q2 || !q3) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    console.log("[api/survey/submit]", { q1, q2, q3, q4, q5, q6, q7, q8 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
