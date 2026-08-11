import { NextResponse } from "next/server";
import { legacyConnectorRetirementPayload } from "@/lib/legacy-connector-retirement";
import { gmailOAuthBindingCookie, gmailOAuthStateCookie, oauthStateCookieOptions } from "@/lib/oauth-state";

export const dynamic = "force-dynamic";

export function GET() {
  const response = NextResponse.json(legacyConnectorRetirementPayload, {
    status: 410,
    headers: { "cache-control": "no-store" },
  });
  response.cookies.set(gmailOAuthStateCookie, "", { ...oauthStateCookieOptions(), maxAge: 0 });
  response.cookies.set(gmailOAuthBindingCookie, "", { ...oauthStateCookieOptions(), maxAge: 0 });
  return response;
}
