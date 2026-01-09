export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getSession, saveSession } from "../../_utils/session";

export async function GET(request) {
  const APP_URL = process.env.APP_URL || "http://localhost:3000";
  const CLIENT_ID = process.env.X_CLIENT_ID;
  const CLIENT_SECRET = process.env.X_CLIENT_SECRET || "";
  if (!CLIENT_ID) return NextResponse.json({ ok: false, error: "X_CLIENT_ID missing" }, { status: 500 });

  const { sid, data } = await getSession();

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  if (!code) return NextResponse.json({ ok: false, error: "Missing code" }, { status: 400 });
  if (!state) return NextResponse.json({ ok: false, error: "Missing state" }, { status: 400 });

  if (!data?.x?.state || data.x.state !== state) {
    return NextResponse.json({ ok: false, error: "Invalid state" }, { status: 400 });
  }
  if (!data?.x?.pkce_verifier) {
    return NextResponse.json({ ok: false, error: "Missing PKCE verifier" }, { status: 400 });
  }

  const redirectUri = `${APP_URL}/api/x/callback`;

  // Exchange code -> token
  const body = new URLSearchParams();
  body.set("code", code);
  body.set("grant_type", "authorization_code");
  body.set("client_id", CLIENT_ID);
  body.set("redirect_uri", redirectUri);
  body.set("code_verifier", data.x.pkce_verifier);

  const headers = { "content-type": "application/x-www-form-urlencoded" };
  if (CLIENT_SECRET) {
    const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
    headers["authorization"] = `Basic ${basic}`;
  }

  const tokenRes = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers,
    body,
  });

  const tokenJson = await tokenRes.json();
  if (!tokenRes.ok) {
    return NextResponse.json({ ok: false, error: "Token exchange failed", detail: tokenJson }, { status: 500 });
  }

  const accessToken = tokenJson.access_token;
  if (!accessToken) {
    return NextResponse.json({ ok: false, error: "No access_token" }, { status: 500 });
  }

  // Get user
  const meRes = await fetch("https://api.x.com/2/users/me", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const meJson = await meRes.json();
  if (!meRes.ok) {
    return NextResponse.json({ ok: false, error: "users/me failed", detail: meJson }, { status: 500 });
  }

  const user = meJson?.data || null;

  data.x = data.x || {};
  data.x.access_token = accessToken;
  data.x.user = user; // {id, name, username}
  data.followed = false; // will be confirmed by follow endpoint
  await saveSession(sid, data);

  return NextResponse.redirect(`${APP_URL}/claim`);
}
