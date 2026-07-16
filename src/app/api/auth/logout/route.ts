import { NextResponse } from "next/server";
import {
  gmailOAuthBindingCookie,
  gmailOAuthStateCookie,
  googleAuthNextCookie,
  googleAuthStateCookie,
  oauthStateCookieOptions,
} from "@/lib/oauth-state";
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
    const response = NextResponse.json({ status: "revocation-pending", revoked: false }, { status: 503 });
    clearOAuthCookies(response);
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
  clearOAuthCookies(response);
}

function clearOAuthCookies(response: NextResponse) {
  for (const name of [gmailOAuthStateCookie, gmailOAuthBindingCookie, googleAuthStateCookie, googleAuthNextCookie]) {
    response.cookies.set(name, "", { ...oauthStateCookieOptions(), maxAge: 0 });
  }
}
