// app/api/_utils/session.js
import { cookies } from "next/headers";
import { storeGet, storeSet } from "./store";

function getSidFromCookies() {
  const c = cookies();
  return c.get("sid")?.value || "";
}

function setSidCookie(sid) {
  const c = cookies();
  c.set("sid", sid, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function getSession() {
  let sid = getSidFromCookies();
  if (!sid) {
    sid = crypto.randomUUID();
    setSidCookie(sid);
  }

  const key = `sess:${sid}`;
  const data = (await storeGet(key)) || {};
  return { sid, key, data };
}

export async function saveSession(sid, data, ttlSec = 60 * 60 * 24 * 7) {
  const key = `sess:${sid}`;
  await storeSet(key, data, ttlSec);
}
