import PostalMime from "postal-mime";

import {
  companyMailForwardDestinationHash,
  forwardedSourceHashesForDestination,
  selectCompanyMailForForwarding,
} from "./lib/company-mail-forwarding.mjs";

const resendApi = "https://api.resend.com";
const maximumRawBytes = 20 * 1024 * 1024;
const execute = process.argv.includes("--execute");

if (process.argv.includes("--help")) {
  console.log(`Forward approved Vognary role-address mail while retaining originals in Resend.

Usage:
  npm run company-mail:forward
  npm run company-mail:forward -- --execute

Required env:
  RESEND_API_KEY
  RESEND_FROM_EMAIL
  COMPANY_MAIL_FORWARD_TO

Dry-run is the default. Output contains counts only, never addresses, names, subjects, bodies, headers, attachments, links, or provider IDs.`);
  process.exit(0);
}

const apiKey = process.env.RESEND_API_KEY?.trim();
const from = process.env.RESEND_FROM_EMAIL?.trim();
const destination = process.env.COMPANY_MAIL_FORWARD_TO?.trim().toLowerCase();
if (!apiKey || !from || !validEmail(destination)) {
  console.error("Company mail forwarding unavailable: required configuration is missing or invalid.");
  process.exit(1);
}
const destinationHash = companyMailForwardDestinationHash(destination);

const headers = { authorization: `Bearer ${apiKey}` };
const received = await getJson("/emails/receiving?limit=100");
const forwardedSourceHashes = await loadForwardedSourceHashes();
const plan = selectCompanyMailForForwarding(
  Array.isArray(received?.data) ? received.data : [],
  forwardedSourceHashes,
);

if (!execute) {
  console.log(JSON.stringify({
    mode: "dry-run",
    eligible: plan.length,
    previouslyForwarded: forwardedSourceHashes.size,
  }, null, 2));
  process.exit(0);
}

let accepted = 0;
let failed = 0;
const failureCategories = {};
for (const item of plan) {
  try {
    const email = await getJson(`/emails/receiving/${encodeURIComponent(item.emailId)}`);
    const rawUrl = typeof email?.raw?.download_url === "string" ? email.raw.download_url : "";
    if (!rawUrl) throw new Error("raw-unavailable");
    const rawResponse = await fetch(rawUrl, { signal: AbortSignal.timeout(15_000) });
    if (!rawResponse.ok) throw new Error("raw-download-failed");
    const raw = await rawResponse.arrayBuffer();
    if (raw.byteLength > maximumRawBytes) throw new Error("raw-too-large");
    const parsed = await PostalMime.parse(raw, { attachmentEncoding: "base64" });
    const response = await fetch(`${resendApi}/emails`, {
      method: "POST",
      headers: {
        ...headers,
        "content-type": "application/json",
        "idempotency-key": `company-mail-forward/${item.sourceHash}/${destinationHash}`,
      },
      body: JSON.stringify({
        from,
        to: [destination],
        reply_to: preferredReplyAddress(email) || undefined,
        subject: forwardSubject(item.alias, email?.subject),
        text: parsed.text || undefined,
        html: parsed.html || undefined,
        attachments: parsed.attachments.length
          ? parsed.attachments.map((attachment) => ({
              filename: attachment.filename,
              content: attachment.content.toString(),
              content_type: attachment.mimeType,
              content_id: attachment.contentId?.replace(/^<|>$/g, "") || undefined,
            }))
          : undefined,
        tags: [
          { name: "purpose", value: "company_mail_forward" },
          { name: "source_hash", value: item.sourceHash },
          { name: "destination_hash", value: destinationHash },
          { name: "original_alias", value: item.alias },
        ],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`send-${response.status}`);
    accepted += 1;
  } catch (error) {
    failed += 1;
    const category = safeFailureCategory(error);
    failureCategories[category] = (failureCategories[category] ?? 0) + 1;
  }
}

console.log(JSON.stringify({
  mode: "execute",
  eligible: plan.length,
  accepted,
  failed,
  failureCategories,
}, null, 2));
if (failed) process.exitCode = 1;

async function loadForwardedSourceHashes() {
  const sent = await getJson("/emails?limit=100");
  const candidates = (Array.isArray(sent?.data) ? sent.data : [])
    .filter((email) => (
      typeof email?.subject === "string"
      && email.subject.startsWith("Fwd: [")
      && Array.isArray(email?.to)
      && email.to.map(normalizeAddress).includes(destination)
    ));
  const details = [];
  for (const candidate of candidates) {
    const detail = await getJson(`/emails/${encodeURIComponent(candidate.id)}`);
    details.push(detail);
  }
  return forwardedSourceHashesForDestination(details, destination);
}

async function getJson(path) {
  const response = await fetch(`${resendApi}${path}`, {
    headers,
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`provider-${response.status}`);
  return response.json();
}

function preferredReplyAddress(email) {
  const replyTo = Array.isArray(email?.reply_to) ? email.reply_to[0] : "";
  const candidate = normalizeAddress(replyTo || email?.from);
  return validEmail(candidate) ? candidate : "";
}

function forwardSubject(alias, value) {
  const subject = typeof value === "string" ? value.replace(/[\r\n]+/g, " ").trim() : "";
  return `Fwd: [${alias}@vognary.com] ${subject || "(no subject)"}`.slice(0, 900);
}

function normalizeAddress(value) {
  if (typeof value !== "string") return "";
  const enclosed = value.match(/<([^<>]+)>/)?.[1];
  return (enclosed ?? value).trim().toLowerCase();
}

function validEmail(value) {
  return typeof value === "string" && value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function safeFailureCategory(error) {
  const message = error instanceof Error ? error.message : "";
  return /^(raw-unavailable|raw-download-failed|raw-too-large|provider-[45]\d\d|send-[45]\d\d)$/.test(message)
    ? message
    : "unknown";
}