import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  const token = req.cookies.get("x_access_token")?.value;
  if (!token) return NextResponse.json({ ok: false, error: "Not logged in" }, { status: 401 });

  const r = await fetch("https://api.twitter.com/2/users/me", {
    headers: { Authorization: `Bearer ${token}` },
  });

  const j = await r.json();
  return NextResponse.json({ ok: r.ok, data: j }, { status: r.status });
}
