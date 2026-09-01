import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { GET as checkoutGet } from "../src/app/api/checkout/route";
import { commitmentControlPilotOffer } from "../src/lib/pilot-offer";
import { getPilotPaymentLink } from "../src/lib/pilot-payment-link";

test("the live commercial offer is the ₹14,999 Commitment Control pilot, not the retired audit SKU", () => {
  assert.equal(commitmentControlPilotOffer.id, "commitment-control-private-pilot");
  assert.equal(commitmentControlPilotOffer.amountMinor, 1_499_900);
  assert.equal(commitmentControlPilotOffer.currency, "INR");
  assert.equal(commitmentControlPilotOffer.billingMode, "ONE_TIME");
  assert.equal(commitmentControlPilotOffer.pilotMonths, 1);
  assert.equal(commitmentControlPilotOffer.proposalLimit, 10);
  assert.equal(commitmentControlPilotOffer.reconciliationReviewLimit, 4);
  assert.equal(commitmentControlPilotOffer.additionalFounderSupportMinutes, 120);
  assert.equal(commitmentControlPilotOffer.activationDeadlineBusinessDays, 10);
  assert.equal(commitmentControlPilotOffer.amountMinor % 100, 0);
});

test("an absent or blank Payment Link stays unavailable without leaking env names", () => {
  withPaymentLink(undefined, () => {
    assert.deepEqual(getPilotPaymentLink(), { status: "unavailable" });
  });
  withPaymentLink("   ", () => {
    assert.deepEqual(getPilotPaymentLink(), { status: "unavailable" });
  });
});

test("only https Razorpay Payment Link hosts are accepted", () => {
  withPaymentLink("https://rzp.io/i/vognary-sub", () => {
    assert.deepEqual(getPilotPaymentLink(), { status: "ready", href: "https://rzp.io/i/vognary-sub" });
  });
  withPaymentLink("https://pages.razorpay.com/pl_example", () => {
    assert.deepEqual(getPilotPaymentLink(), { status: "ready", href: "https://pages.razorpay.com/pl_example" });
  });
  withPaymentLink("https://checkout.rzp.io/l/hosted", () => {
    assert.deepEqual(getPilotPaymentLink(), { status: "ready", href: "https://checkout.rzp.io/l/hosted" });
  });
  withPaymentLink("http://rzp.io/l/insecure", () => {
    assert.deepEqual(getPilotPaymentLink(), { status: "unavailable" });
  });
  withPaymentLink("https://rzp.io.attacker.com/l/spoof", () => {
    assert.deepEqual(getPilotPaymentLink(), { status: "unavailable" });
  });
  withPaymentLink("https://user:secret@rzp.io/l/creds", () => {
    assert.deepEqual(getPilotPaymentLink(), { status: "unavailable" });
  });
  withPaymentLink("https://evil.example/pay", () => {
    assert.deepEqual(getPilotPaymentLink(), { status: "unavailable" });
  });
  withPaymentLink("javascript:alert(1)", () => {
    assert.deepEqual(getPilotPaymentLink(), { status: "unavailable" });
  });
});

test("a hosted link stays unavailable unless the operator records one-time collection mode", () => {
  withPaymentLink("https://rzp.io/i/vognary-pilot", () => {
    assert.deepEqual(getPilotPaymentLink(), { status: "unavailable" });
  }, null);
  withPaymentLink("https://rzp.io/i/vognary-pilot", () => {
    assert.deepEqual(getPilotPaymentLink(), { status: "unavailable" });
  }, "subscription");
});

test("retired /api/checkout stays 410 after the pilot pay page exists", async () => {
  const response = await checkoutGet();
  assert.equal(response.status, 410);
});

test("the pay page is server-priced and does not revive Standard Checkout or the retired audit amount", () => {
  const page = source("src/app/pay/page.tsx");
  const about = source("src/app/about/page.tsx");
  const contact = source("src/app/contact/page.tsx");
  const terms = source("src/app/terms/page.tsx");
  const agentContent = source("src/lib/agent-content.ts");
  const trustSignals = source("src/lib/server/trust-signals.ts");
  const invoiceMarkdown = source("docs/templates/invoice-template.md");
  const invoiceHtml = source("docs/templates/invoice-template.html");
  const link = source("src/lib/pilot-payment-link.ts");
  const offer = source("src/lib/pilot-offer.ts");
  assert.match(page, /commitmentControlPilotOffer/);
  assert.match(page, /getPilotPaymentLink/);
  assert.match(page, /one-time/i);
  assert.match(page, /ten business days/i);
  assert.match(page, /full refund/i);
  assert.doesNotMatch(page, /monthly Razorpay subscription|authorisation charge|auto-renew|50 commitment evaluations|one-business-day response SLA/i);
  assert.doesNotMatch(page, /checkout\.razorpay\.com|razorpay_payment_id|create-order|99_900|assisted-audit|COMMITMENT_CONTROL_PILOT/i);
  assert.doesNotMatch(link, /RAZORPAY_KEY_SECRET|NEXT_PUBLIC_RAZORPAY/);
  assert.match(offer, /1_499_900/);
  assert.doesNotMatch(offer, /4_000_000/);

  for (const surface of [contact, terms, agentContent, trustSignals, invoiceMarkdown, invoiceHtml]) {
    assert.match(surface, /₹14,999/);
    assert.match(surface, /one-time/i);
    assert.doesNotMatch(surface, /monthly Razorpay subscription|Subscription Link|auto-renew|auto-renewing|50 commitment evaluations|one-business-day response SLA/i);
  }
  assert.match(terms, /ten business days/i);
  assert.match(terms, /full refund/i);
  assert.match(terms, /separate (?:purchase|payment)/i);
  assert.match(about, /Reserve the private pilot/);
  assert.match(about, /20[–-]100 person AI-native companies/);
  assert.doesNotMatch(about, /5[–-]100 person AI-native companies/);
  assert.doesNotMatch(about, /Subscribe at the pilot rate/i);
});

test("founder operations collect once and keep Control unenrolled until payment and assurance clear", () => {
  const readme = source("README.md");
  const founderOps = source("docs/founder-ops-setup.md");
  const paymentSection = founderOps.split("## 5.", 2)[1]?.split("## 6.", 1)[0] ?? "";
  const activation = source("docs/production-activation-runbook.md");

  assert.match(readme, /one-time ₹14,999/i);
  assert.match(paymentSection, /one-time Payment Link/i);
  assert.match(paymentSection, /COMMITMENT_CONTROL_PILOT_PAYMENT_LINK_MODE=one-time/);
  assert.match(paymentSection, /do not (?:create|configure).*Subscription/i);
  assert.doesNotMatch(paymentSection, /New Plan|monthly autopay|Total count/i);
  assert.match(activation, /keep `COMMITMENT_CONTROL_PILOT_WORKSPACE_IDS` unset/i);
  assert.match(activation, /cleared payment[\s\S]*independent security (?:assessment|review)/i);
});

function withPaymentLink(value: string | undefined, run: () => void, mode: string | null = value === undefined ? null : "one-time") {
  const previous = process.env.COMMITMENT_CONTROL_PILOT_PAYMENT_LINK_URL;
  const previousMode = process.env.COMMITMENT_CONTROL_PILOT_PAYMENT_LINK_MODE;
  try {
    if (value === undefined) delete process.env.COMMITMENT_CONTROL_PILOT_PAYMENT_LINK_URL;
    else process.env.COMMITMENT_CONTROL_PILOT_PAYMENT_LINK_URL = value;
    if (mode === null) delete process.env.COMMITMENT_CONTROL_PILOT_PAYMENT_LINK_MODE;
    else process.env.COMMITMENT_CONTROL_PILOT_PAYMENT_LINK_MODE = mode;
    run();
  } finally {
    if (previous === undefined) delete process.env.COMMITMENT_CONTROL_PILOT_PAYMENT_LINK_URL;
    else process.env.COMMITMENT_CONTROL_PILOT_PAYMENT_LINK_URL = previous;
    if (previousMode === undefined) delete process.env.COMMITMENT_CONTROL_PILOT_PAYMENT_LINK_MODE;
    else process.env.COMMITMENT_CONTROL_PILOT_PAYMENT_LINK_MODE = previousMode;
  }
}

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}
