// app/api/recommend/route.ts
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get("query") ?? "";
    if (!query) return NextResponse.json({ error: "Missing query" }, { status: 400 });

    const url = `https://n8n.naturalheroes.nl/webhook/get-products-embeddings?query=${encodeURIComponent(query)}`;
    const r = await fetch(url, { method: "GET", cache: "no-store" });
    const text = await r.text();
    try { return NextResponse.json(JSON.parse(text)); }
    catch { return NextResponse.json({ raw: text }); }
  } catch {
    return NextResponse.json({ error: "Upstream error" }, { status: 502 });
  }
}
