import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function env(name, fallback = "") {
  return (process.env[name] || fallback).toString().trim();
}

function b64(str) {
  return Buffer.from(str).toString("base64");
}

async function postToken({ code, codeVerifier, redirectUri }) {
  const X_CLIENT_ID = env("X_CLIENT_ID");
  const X_CLIENT_SECRET = env("X_CLIENT_SECRET");

  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", code);
  body.set("redirect_uri", redirectUri);
  body.set("client_id", X_CLIENT_ID);
  body.set("code_verifier", codeVerifier);

  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
  };

  // confidential client -> Basic auth
  if (X_CLIENT_SECRET) {
    headers["Authorization"] = `Basic ${b64(`${X_CLIENT_ID}:${X_CLIENT_SECRET}`)}`;
  }

  const r = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers,
    body,
  });

  const j = await r.json();
  return { ok: r.ok, status: r.status, json: j };
}

export async function GET(req) {
  const APP_URL = env("APP_URL");
  if (!APP_URL) return NextResponse.json({ ok: false, error: "Missing APP_URL" }, { status: 500 });

  const appUrl = APP_URL.replace(/\/+$/, "");
  const redirectUri = `${appUrl}/api/x/callback`;

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(`${appUrl}/?x_error=${encodeURIComponent(error)}`);
  }
  if (!code || !state) {
    return NextResponse.redirect(`${appUrl}/?x_error=missing_code_or_state`);
  }

  const cookieState = req.cookies.get("x_oauth_state")?.value;
  const codeVerifier = req.cookies.get("x_oauth_verifier")?.value;

  if (!cookieState || !codeVerifier) {
    return NextResponse.redirect(`${appUrl}/?x_error=missing_pkce_cookie`);
  }
  if (cookieState !== state) {
    return NextResponse.redirect(`${appUrl}/?x_error=state_mismatch`);
  }

  const token = await postToken({ code, codeVerifier, redirectUri });

  if (!token.ok) {
    const msg = token.json?.error_description || token.json?.error || `token_failed_${token.status}`;
    return NextResponse.redirect(`${appUrl}/?x_error=${encodeURIComponent(msg)}`);
  }

  const accessToken = token.json.access_token;
  const refreshToken = token.json.refresh_token;

  const res = NextResponse.redirect(`${appUrl}/claim`);

  const secure = appUrl.startsWith("https://");
  // save tokens
  res.cookies.set("x_access_token", accessToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  if (refreshToken) {
    res.cookies.set("x_refresh_token", refreshToken, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  // clear PKCE cookies
  res.cookies.set("x_oauth_state", "", { path: "/", maxAge: 0 });
  res.cookies.set("x_oauth_verifier", "", { path: "/", maxAge: 0 });

  return res;
}
