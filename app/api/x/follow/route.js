export const runtime = "nodejs";

import { NextResponse } from "next/server";

export async function POST(req) {
  const TARGET_USER_ID = process.env.X_TARGET_USER_ID;
  if (!TARGET_USER_ID)
    return NextResponse.json(
      { ok: false, error: "X_TARGET_USER_ID missing" },
      { status: 500 }
    );

  // Token disimpan di cookie x_access_token oleh /api/x/callback
  const token = req.cookies.get("x_access_token")?.value;
  if (!token)
    return NextResponse.json(
      { ok: false, error: "Not logged in with X" },
      { status: 401 }
    );

  // Ambil user ID dari X API
  const meRes = await fetch("https://api.twitter.com/2/users/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const meJson = await meRes.json();
  const userId = meJson?.data?.id;

  if (!meRes.ok || !userId) {
    return NextResponse.json(
      { ok: false, error: "Failed to get X user info" },
      { status: 401 }
    );
  }

  // Follow via X API
  const res = await fetch(`https://api.x.com/2/users/${userId}/following`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ target_user_id: TARGET_USER_ID }),
  });

  const j = await res.json();

  // If already following, treat as success
  if (
    !res.ok &&
    !String(j?.detail || "")
      .toLowerCase()
      .includes("already")
  ) {
    return NextResponse.json(
      { ok: false, error: "Follow API failed", detail: j },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, data: j?.data || null });
}
