import { commitmentControlPilotOffer } from "./pilot-offer";

export type PilotPaymentLink =
  | { status: "ready"; href: string }
  | { status: "unavailable" };

const allowedHosts = new Set(["rzp.io", "pages.razorpay.com"]);

export function getPilotPaymentLink(): PilotPaymentLink {
  if (process.env.COMMITMENT_CONTROL_PILOT_PAYMENT_LINK_MODE?.trim() !== "one-time") {
    return { status: "unavailable" };
  }
  const href = parsePilotPaymentLink(process.env.COMMITMENT_CONTROL_PILOT_PAYMENT_LINK_URL);
  return href && hasVerifiedOffer(href, process.env.COMMITMENT_CONTROL_PILOT_PAYMENT_LINK_VERIFICATION)
    ? { status: "ready", href }
    : { status: "unavailable" };
}

function hasVerifiedOffer(href: string, raw: string | undefined): boolean {
  if (!raw || raw.length > 8_192) return false;
  try {
    const record: unknown = JSON.parse(raw);
    if (!record || typeof record !== "object" || Array.isArray(record)) return false;
    const value = record as Record<string, unknown>;
    return value.status === "VERIFIED"
      && typeof value.href === "string" && parsePilotPaymentLink(value.href) === href
      && value.amountMinor === String(commitmentControlPilotOffer.amountMinor)
      && value.currency === commitmentControlPilotOffer.currency
      && value.billingMode === commitmentControlPilotOffer.billingMode
      && value.providerMode === "LIVE"
      && value.offerVersion === commitmentControlPilotOffer.version
      && value.termsVersion === commitmentControlPilotOffer.termsVersion
      && typeof value.verifiedAt === "string" && new Date(value.verifiedAt).toISOString() === value.verifiedAt
      && typeof value.evidenceSha256 === "string" && /^[a-f0-9]{64}$/.test(value.evidenceSha256);
  } catch {
    return false;
  }
}

export function parsePilotPaymentLink(raw: string | undefined): string | null {
  const value = raw?.trim() ?? "";
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  const allowed = allowedHosts.has(host) || host.endsWith(".rzp.io");
  if (!allowed) return null;
  if (url.username || url.password) return null;
  return url.toString();
}
