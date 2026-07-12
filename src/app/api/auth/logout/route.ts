import { NextResponse } from "next/server";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";
import { revokeCurrentSession, sessionCookieName } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;

  let revoked = false;
  try {
    revoked = await revokeCurrentSession(request);
  } catch {
    // Clear the browser credential even during a database outage. A copied
    // credential cannot authorize requests while current-session validation is
    // unavailable; the non-2xx response tells the caller to retry revocation.
    const response = NextResponse.json({ status: "local-session-cleared", revoked: false }, { status: 503 });
    clearSessionCookie(response);
    return response;
  }

  const response = NextResponse.json({ status: "signed-out", revoked });
  clearSessionCookie(response);
  return response;
}

function clearSessionCookie(response: NextResponse) {
  response.cookies.set(sessionCookieName, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}
