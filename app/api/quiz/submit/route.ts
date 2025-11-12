import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { quizId, answer } = await req.json().catch(() => ({} as any));
    if (!quizId || !answer) {
      return NextResponse.json({ error: "Missing quizId or answer" }, { status: 400 });
    }

    // TODO: Persist to your DB here (Prisma/Drizzle/Supabase/etc.)
    // Example (pseudo):
    // await db.quizAnswer.create({ data: { quizId, answer, userId: ... } });

    console.log("[api/quiz/submit] saved", { quizId, answer });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/quiz/submit] error", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
