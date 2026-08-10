export const gmailOAuthStateCookie = "vognary_gmail_oauth_state";
export const gmailOAuthBindingCookie = "vognary_gmail_oauth_binding";
export const googleAuthStateCookie = "vognary_google_auth_state";
export const googleAuthNextCookie = "vognary_google_auth_next";
export const googleAuthNonceCookie = "vognary_google_auth_nonce";
export const googleAuthPkceCookie = "vognary_google_auth_pkce";

export function oauthStateCookieOptions() {
  return {
    httpOnly: true,
    maxAge: 10 * 60,
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}

export function sanitizeOAuthReturnPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/app";
  try {
    const url = new URL(value, "https://vognary.invalid");
    if (url.origin !== "https://vognary.invalid" || url.pathname === "/login" || url.pathname.startsWith("/login/")) return "/app";
  } catch {
    return "/app";
  }
  return value;
}
