export const gmailOAuthStateCookie = "vognary_gmail_oauth_state";
export const googleAuthStateCookie = "vognary_google_auth_state";

export function oauthStateCookieOptions() {
  return {
    httpOnly: true,
    maxAge: 10 * 60,
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}