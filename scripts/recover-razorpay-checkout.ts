import {
  attachBillingProviderCheckout,
  getBillingCheckoutForRecovery,
  releaseBillingProviderCreationAfterVerifiedAbsence,
} from "../src/lib/server/billing-store";
import { getDatabasePool } from "../src/lib/server/database";
import { publicOffer } from "../src/lib/public-offer";

const checkoutId = readFlag("--checkout");
const confirmed = process.argv.includes("--confirm");
const keyId = process.env.RAZORPAY_KEY_ID?.trim();
const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if (process.argv.includes("--help")) {
  console.log("Recover one uncertain Razorpay Payment Link by its Vognary checkout reference.\n\nUsage:\n  DATABASE_URL='...' RAZORPAY_KEY_ID='...' RAZORPAY_KEY_SECRET='...' npm run billing:recover-checkout -- --checkout <uuid> --confirm");
  process.exit(0);
}
if (!process.env.DATABASE_URL || !checkoutId || !uuidPattern.test(checkoutId) || !keyId || !keySecret || !confirmed) {
  console.error("DATABASE_URL, Razorpay credentials, a valid --checkout UUID, and --confirm are required.");
  process.exit(1);
}

void main();

async function main() {
  try {
    const normalizedCheckoutId = checkoutId!.toLowerCase();
    const checkout = await getBillingCheckoutForRecovery(normalizedCheckoutId);
    const creationStartedAt = checkout?.providerCreationStartedAt ? Date.parse(checkout.providerCreationStartedAt) : Number.NaN;
    const staleClaim = Number.isFinite(creationStartedAt) && creationStartedAt <= Date.now() - 15 * 60_000;
    if (!checkout
      || !["created", "failed", "reconciliation_required"].includes(checkout.status)
      || !staleClaim
      || checkout.providerCheckoutId
      || checkout.providerCheckoutUrl) {
      throw new Error("Checkout is not an unresolved Razorpay creation claim.");
    }
    if (checkout.plan !== publicOffer.plan
      || checkout.offerId !== publicOffer.id
      || checkout.offerVersion !== publicOffer.version
      || checkout.termsVersion !== publicOffer.termsVersion
      || checkout.currency !== publicOffer.currency
      || checkout.amountMinor !== publicOffer.amountMinor) {
      throw new Error("Checkout does not match the current server-owned assisted-audit offer.");
    }

    const url = new URL("https://api.razorpay.com/v1/payment_links");
    url.searchParams.set("reference_id", normalizedCheckoutId);
    url.searchParams.set("count", "10");
    const response = await fetch(url, {
      headers: { authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Razorpay filtered Payment Link lookup failed with HTTP ${response.status}.`);
    const payload = await response.json() as { items?: RazorpayPaymentLink[] };
    if (!Array.isArray(payload.items)) throw new Error("Razorpay Payment Link lookup returned an invalid response.");
    const matches = payload.items.filter((item) => item.reference_id === normalizedCheckoutId);

    if (payload.items.length === 0) {
      const released = await releaseBillingProviderCreationAfterVerifiedAbsence(normalizedCheckoutId);
      if (!released) throw new Error("Checkout claim changed before verified-absence release.");
      console.log(JSON.stringify({ status: "verified-absent-claim-released", checkoutId: normalizedCheckoutId }, null, 2));
      return;
    }
    if (matches.length === 0) throw new Error("Razorpay returned nonmatching links for the filtered checkout reference. Do not release or create another link.");
    if (matches.length !== 1) throw new Error("Razorpay returned multiple links for the checkout reference. Do not attach or create another link.");

    const match = matches[0];
    if (!/^plink_[A-Za-z0-9]+$/.test(match.id ?? "")
      || !isHttpsUrl(match.short_url)
      || match.amount !== checkout.amountMinor
      || match.currency !== checkout.currency
      || !["created", "issued", "partially_paid"].includes(match.status ?? "")) {
      throw new Error("Razorpay link identity, amount, currency, URL, or state does not match the local checkout.");
    }
    await attachBillingProviderCheckout({
      checkoutId: normalizedCheckoutId,
      providerCheckoutId: match.id!,
      paymentUrl: match.short_url!,
    });
    console.log(JSON.stringify({ status: "attached-existing-provider-link", checkoutId: normalizedCheckoutId, providerCheckoutId: match.id }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Razorpay checkout recovery failed.");
    process.exitCode = 1;
  } finally {
    await getDatabasePool().end();
  }
}

type RazorpayPaymentLink = {
  id?: string;
  reference_id?: string;
  short_url?: string;
  amount?: number;
  currency?: string;
  status?: string;
};

function readFlag(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function isHttpsUrl(value: string | undefined) {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
