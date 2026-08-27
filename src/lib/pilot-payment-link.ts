export type PilotPaymentLink =
  | { status: "ready"; href: string }
  | { status: "unavailable" };

const allowedHosts = new Set(["rzp.io", "pages.razorpay.com"]);

export function getPilotPaymentLink(): PilotPaymentLink {
  const href = parsePilotPaymentLink(process.env.COMMITMENT_CONTROL_PILOT_PAYMENT_LINK_URL);
  return href ? { status: "ready", href } : { status: "unavailable" };
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
