import "server-only";

/**
 * Authorities whose `Authentication-Results` this deployment accepts.
 *
 * These are the mail hops we are willing to quote — normally the forwarding
 * provider that authenticated the merchant's message before relaying it to a
 * receipt alias. The list is empty unless an operator configures it, so
 * `VERIFIED_SENDER` is unreachable on an unconfigured deployment rather than
 * being granted by an unvouched header.
 */
export function getReceiptInboxTrustedAuthorities(): readonly string[] {
  const configured = process.env.RECEIPT_INBOX_TRUSTED_AUTH_AUTHORITIES?.trim();
  if (!configured) return [];
  const authorities = configured
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0 && value.length <= 253 && /^[a-z0-9][a-z0-9.-]*$/.test(value));
  return [...new Set(authorities)].slice(0, 8);
}
