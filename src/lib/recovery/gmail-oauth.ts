/**
 * Recovery-native Gmail stays fail-closed.
 *
 * `gmail.readonly` is a Restricted Google scope. Production mailbox storage for
 * external users requires OAuth verification and an annual third-party security
 * assessment: https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification
 * Status: BLOCKED BY EXTERNAL APPROVAL. Do not expose Connect.
 */
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
