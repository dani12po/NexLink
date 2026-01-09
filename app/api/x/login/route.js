export const runtime = "nodejs";

import { NextResponse } from "next/server";
import crypto from "crypto";
import { getSession, saveSession } from "../../_utils/session";

function base64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export async function GET() {
  const APP_URL = process.env.APP_URL || "http://localhost:3000";
  const CLIENT_ID = process.env.X_CLIENT_ID;
  const SCOPES = process.env.X_OAUTH_SCOPES || "tweet.read users.read follows.write offline.access";
  if (!CLIENT_ID) return NextResponse.json({ ok: false, error: "X_CLIENT_ID missing" }, { status: 500 });

  const { sid, data } = await getSession();

  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  const state = base64url(crypto.randomBytes(16));

  data.x = data.x || {};
  data.x.pkce_verifier = verifier;
  data.x.state = state;

  await saveSession(sid, data);

  const redirectUri = `${APP_URL}/api/x/callback`;

  const url =
    "https://x.com/i/oauth2/authorize" +
    `?response_type=code` +
    `&client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&state=${encodeURIComponent(state)}` +
    `&code_challenge=${encodeURIComponent(challenge)}` +
    `&code_challenge_method=S256`;

  return NextResponse.redirect(url);
}
