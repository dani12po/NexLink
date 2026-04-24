import { cookies } from "next/headers";
import { get, set } from "./store.js";
import { randomString } from "./pkce.js";

const COOKIE_NAME = "acg_sid";

export function getSessionId() {
  return cookies().get(COOKIE_NAME)?.value || "";
}

export async function getSession() {
  const sid = getSessionId();
  if (!sid) return null;
  return await get(`session:${sid}`);
}

export async function createSession(data) {
  const sid = randomString(24);
  await set(`session:${sid}`, data, { ex: 60 * 60 }); // 1 hour

  const secure = process.env.NODE_ENV === "production";
  cookies().set(COOKIE_NAME, sid, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 60,
  });

  return sid;
}

export async function updateSession(patch) {
  const sid = getSessionId();
  if (!sid) return null;
  const cur = (await get(`session:${sid}`)) || {};
  const next = { ...cur, ...patch };
  await set(`session:${sid}`, next, { ex: 60 * 60 });
  return next;
}
