/** Gmail's forwarding-confirmation mail is not a billing receipt. */

export const gmailVerificationPendingCode = "GMAIL_VERIFICATION_PENDING";

export function isGmailVerificationPendingCode(errorCode: string | null | undefined) {
  return errorCode === gmailVerificationPendingCode;
}

export function selectReceiptInboxHealthEvent<T extends { error_code: string | null }>(
  eventsNewestFirst: readonly T[],
) {
  return eventsNewestFirst.find((event) => !isGmailVerificationPendingCode(event.error_code));
}
