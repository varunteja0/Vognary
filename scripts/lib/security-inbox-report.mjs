import { createHash } from "node:crypto";

const defaultMailbox = "security@vognary.com";
const syntheticSubject = "vognary reply-route synthetic test 2026-09-03";
const assessorDomains = new Set([
  "kratikal.com",
  "networkintelligence.ai",
  "qrcsolutionz.com",
  "sisa.ai",
  "sisainfosec.com",
  "strobes.co",
  "wesecureapp.com",
]);

export function summarizeSecurityInbox(messages, options = {}) {
  const mailbox = normalizeAddress(options.mailbox || defaultMailbox);
  const handledReviewRefs = new Set(
    Array.isArray(options.handledReviewRefs)
      ? options.handledReviewRefs.filter(isSecurityInboxReviewRef)
      : [],
  );
  const safeMessages = messages
    .filter((message) => recipients(message).includes(mailbox))
    .map((message) => toSafeMessage(message, handledReviewRefs))
    .sort(compareMessages);
  const categories = {
    "assessor-response": 0,
    "automated-confirmation": 0,
    "security-report": 0,
    "synthetic-self-test": 0,
    other: 0,
  };
  for (const message of safeMessages) categories[message.category] += 1;
  const latestReceivedAt = safeMessages
    .map((message) => message.receivedAt)
    .find((value) => validTimestamp(value)) ?? null;

  return {
    inbox: "security-inbox",
    count: safeMessages.length,
    needsReview: safeMessages.filter((message) => message.needsReview).length,
    latestReceivedAt,
    categories,
    messages: safeMessages,
  };
}

export function formatSecurityInboxSummary(summary) {
  const categoryLine = Object.entries(summary.categories)
    .map(([category, count]) => `${category} ${count}`)
    .join(" · ");
  const lines = [
    `Security inbox: ${summary.count} messages · ${summary.needsReview} need review`,
    `Latest: ${summary.latestReceivedAt ?? "none"}`,
    `Categories: ${categoryLine}`,
  ];
  for (const message of summary.messages) {
    const reviewStatus = message.needsReview
      ? ` · OPEN${message.reviewRef ? ` ${message.reviewRef}` : " (untracked)"}`
      : message.reviewRef
        ? " · HANDLED"
        : "";
    lines.push(`${message.receivedAt} · ${message.senderDomain} · ${message.category}${reviewStatus}`);
  }
  return lines.join("\n");
}

function toSafeMessage(message, handledReviewRefs) {
  const senderDomain = domainFromAddress(message?.from);
  const subject = typeof message?.subject === "string" ? message.subject.trim().toLowerCase() : "";
  const category = classifyMessage(subject, senderDomain);
  const requiresReview = category === "assessor-response" || category === "security-report";
  const reviewRef = requiresReview ? reviewRefForMessage(message) : null;
  return {
    receivedAt: validTimestamp(message?.created_at) ? new Date(message.created_at).toISOString() : "unknown",
    senderDomain,
    category,
    ...(reviewRef ? { reviewRef } : {}),
    needsReview: requiresReview && (!reviewRef || !handledReviewRefs.has(reviewRef)),
  };
}

function reviewRefForMessage(message) {
  const providerId = typeof message?.id === "string" ? message.id.trim() : "";
  if (!providerId) return null;
  return createHash("sha256")
    .update(`vognary-security-inbox-review:v1:${providerId}`)
    .digest("hex");
}

export function isSecurityInboxReviewRef(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function classifyMessage(subject, senderDomain) {
  if (subject === syntheticSubject) return "synthetic-self-test";
  if (/\bthank you for (?:your |the )?(?:inquiry|enquiry|submission|contacting us)\b/.test(subject)) {
    return "automated-confirmation";
  }
  if (assessorDomains.has(senderDomain)) return "assessor-response";
  if (/security|vulnerab|responsible disclosure|penetration|vapt|assessment/.test(subject)) {
    return "security-report";
  }
  return "other";
}

function recipients(message) {
  return Array.isArray(message?.to)
    ? message.to.map(normalizeAddress).filter(Boolean)
    : [];
}

function domainFromAddress(value) {
  const address = normalizeAddress(value);
  const at = address.lastIndexOf("@");
  if (at < 1 || at === address.length - 1) return "unknown";
  const domain = address.slice(at + 1);
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) ? domain : "unknown";
}

function normalizeAddress(value) {
  if (typeof value !== "string") return "";
  const enclosed = value.match(/<([^<>]+)>/)?.[1];
  return (enclosed ?? value).trim().toLowerCase();
}

function compareMessages(left, right) {
  const leftTime = timestamp(left.receivedAt);
  const rightTime = timestamp(right.receivedAt);
  if (leftTime === null && rightTime === null) return 0;
  if (leftTime === null) return 1;
  if (rightTime === null) return -1;
  return rightTime - leftTime;
}

function validTimestamp(value) {
  return timestamp(value) !== null;
}

function timestamp(value) {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}