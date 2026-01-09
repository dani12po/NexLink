export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getSession } from "../../_utils/session";

export async function GET() {
  const { data } = await getSession();

  const loggedIn = Boolean(data?.x?.access_token && data?.x?.user?.id);
  return NextResponse.json({
    ok: true,
    loggedIn,
    user: loggedIn ? data.x.user : null,
    followed: Boolean(data?.followed),
    claimed: Boolean(data?.claimed),
    paid: Boolean(data?.payment?.confirmed),
  });
}
