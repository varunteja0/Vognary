/** Recovery-native Gmail stays fail-closed until Google restricted-scope verification/CASA is genuinely approved. */
export function isRecoveryGmailOauthReady(): boolean {
  return process.env.GOOGLE_OAUTH_VERIFICATION_COMPLETE === "true"
    && process.env.GOOGLE_RESTRICTED_SCOPE_CASA_STATUS === "approved";
}

export function recoveryGmailOauthBlockReason(): string {
  if (process.env.GOOGLE_OAUTH_VERIFICATION_COMPLETE !== "true") {
    return "Google restricted-scope verification is not complete.";
  }
  if (process.env.GOOGLE_RESTRICTED_SCOPE_CASA_STATUS !== "approved") {
    return "CASA / security assessment is not approved.";
  }
  return "Recovery-native Gmail OAuth is not publicly enabled.";
}
