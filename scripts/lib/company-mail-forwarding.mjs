import { createHash } from "node:crypto";

const companyDomain = "vognary.com";
const syntheticSubject = "vognary reply-route synthetic test 2026-09-03";
const approvedAliases = new Set([
  "founder",
  "hello",
  "legal",
  "privacy",
  "security",
  "support",
  "varun",
]);

export function companyMailForwardSourceHash(emailId) {
  if (typeof emailId !== "string" || !emailId.trim()) return "";
  return createHash("sha256").update(emailId.trim()).digest("hex").slice(0, 32);
}

export function companyMailForwardDestinationHash(destination) {
  const normalized = normalizeAddress(destination);
  if (!normalized) return "";
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

export function selectCompanyMailForForwarding(messages, forwardedSourceHashes) {
  return messages
    .flatMap((message) => {
      const emailId = typeof message?.id === "string" ? message.id.trim() : "";
      const sourceHash = companyMailForwardSourceHash(emailId);
      const alias = approvedRecipientAlias(message?.to);
      const subject = typeof message?.subject === "string" ? message.subject.trim().toLowerCase() : "";
      if (!emailId || !sourceHash || !alias || subject === syntheticSubject || forwardedSourceHashes.has(sourceHash)) {
        return [];
      }
      return [{
        emailId,
        sourceHash,
        alias,
        receivedAt: normalizeTimestamp(message?.created_at),
      }];
    })
    .sort((left, right) => left.receivedAt.localeCompare(right.receivedAt));
}

export function forwardedSourceHashesForDestination(messages, destination) {
  const normalizedDestination = normalizeAddress(destination);
  const hashes = new Set();
  if (!normalizedDestination) return hashes;
  for (const message of messages) {
    const recipients = Array.isArray(message?.to)
      ? message.to.map(normalizeAddress)
      : [];
    if (!recipients.includes(normalizedDestination)) continue;
    const tags = Array.isArray(message?.tags) ? message.tags : [];
    if (!tags.some((tag) => tag?.name === "purpose" && tag?.value === "company_mail_forward")) continue;
    const sourceHash = tags.find((tag) => tag?.name === "source_hash")?.value;
    if (typeof sourceHash === "string" && /^[a-f0-9]{32}$/.test(sourceHash)) hashes.add(sourceHash);
  }
  return hashes;
}

function approvedRecipientAlias(values) {
  if (!Array.isArray(values) || values.length !== 1) return null;
  const address = normalizeAddress(values[0]);
  const at = address.lastIndexOf("@");
  if (at < 1 || address.slice(at + 1) !== companyDomain) return null;
  const alias = address.slice(0, at);
  return approvedAliases.has(alias) ? alias : null;
}

function normalizeAddress(value) {
  if (typeof value !== "string") return "";
  const enclosed = value.match(/<([^<>]+)>/)?.[1];
  return (enclosed ?? value).trim().toLowerCase();
}

function normalizeTimestamp(value) {
  if (typeof value !== "string") return "unknown";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "unknown";
}