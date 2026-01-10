import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function env(name, fallback = "") {
  return (process.env[name] || fallback).toString().trim();
}

function base64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function randomString(bytes = 32) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return base64url(b);
}

async function sha256(input) {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hash);
}

export async function GET() {
  const APP_URL = env("APP_URL");
  const X_CLIENT_ID = env("X_CLIENT_ID");
  const SCOPES = env("X_OAUTH_SCOPES", "tweet.read users.read follows.write offline.access");

  if (!APP_URL) return NextResponse.json({ ok: false, error: "Missing APP_URL" }, { status: 500 });
  if (!X_CLIENT_ID) return NextResponse.json({ ok: false, error: "Missing X_CLIENT_ID" }, { status: 500 });

  // IMPORTANT: no trailing slash
  const appUrl = APP_URL.replace(/\/+$/, "");
  const redirectUri = `${appUrl}/api/x/callback`;

  const state = randomString(24);
  const codeVerifier = randomString(48);
  const codeChallenge = base64url(await sha256(codeVerifier));

  const authUrl = new URL("https://twitter.com/i/oauth2/authorize");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", X_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  const res = NextResponse.redirect(authUrl.toString());

  // store PKCE in httpOnly cookies
  const secure = appUrl.startsWith("https://");
  res.cookies.set("x_oauth_state", state, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60, // 10 min
  });
  res.cookies.set("x_oauth_verifier", codeVerifier, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  });

  return res;
}
