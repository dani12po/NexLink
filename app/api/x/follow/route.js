export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getSession, saveSession } from "../../_utils/session";

export async function POST() {
  const TARGET_USER_ID = process.env.X_TARGET_USER_ID;
  if (!TARGET_USER_ID) return NextResponse.json({ ok: false, error: "X_TARGET_USER_ID missing" }, { status: 500 });

  const { sid, data } = await getSession();
  const access = data?.x?.access_token;
  const me = data?.x?.user;

  if (!access || !me?.id) return NextResponse.json({ ok: false, error: "Not logged in" }, { status: 401 });

  // Follow via API (this is the "confirmation" step)
  const res = await fetch(`https://api.x.com/2/users/${me.id}/following`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${access}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ target_user_id: TARGET_USER_ID }),
  });

  const j = await res.json();

  // If already following, some setups may still return ok / or error; handle softly
  if (!res.ok && !String(j?.detail || "").toLowerCase().includes("already")) {
    return NextResponse.json({ ok: false, error: "Follow API failed", detail: j }, { status: 500 });
  }

  data.followed = true;
  await saveSession(sid, data);

  return NextResponse.json({ ok: true, data: j?.data || null });
}
