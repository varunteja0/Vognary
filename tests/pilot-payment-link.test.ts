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
  assert.equal(commitmentControlPilotOffer.interval, "month");
  assert.equal(commitmentControlPilotOffer.amountMinor % 100, 0);
  assert.ok(commitmentControlPilotOffer.amountMinor <= 1_500_000, "stay at or under the ₹15,000 UPI Autopay PIN-free cap");
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

test("retired /api/checkout stays 410 after the pilot pay page exists", async () => {
  const response = await checkoutGet();
  assert.equal(response.status, 410);
});

test("the pay page is server-priced and does not revive Standard Checkout or the retired audit amount", () => {
  const page = source("src/app/pay/page.tsx");
  const link = source("src/lib/pilot-payment-link.ts");
  const offer = source("src/lib/pilot-offer.ts");
  assert.match(page, /commitmentControlPilotOffer/);
  assert.match(page, /getPilotPaymentLink/);
  assert.match(page, /monthly Razorpay subscription/);
  assert.match(page, /authorisation charge/);
  assert.doesNotMatch(page, /checkout\.razorpay\.com|razorpay_payment_id|create-order|99_900|assisted-audit|COMMITMENT_CONTROL_PILOT/i);
  assert.doesNotMatch(link, /RAZORPAY_KEY_SECRET|NEXT_PUBLIC_RAZORPAY/);
  assert.match(offer, /1_499_900/);
  assert.doesNotMatch(offer, /4_000_000/);
});

function withPaymentLink(value: string | undefined, run: () => void) {
  const previous = process.env.COMMITMENT_CONTROL_PILOT_PAYMENT_LINK_URL;
  try {
    if (value === undefined) delete process.env.COMMITMENT_CONTROL_PILOT_PAYMENT_LINK_URL;
    else process.env.COMMITMENT_CONTROL_PILOT_PAYMENT_LINK_URL = value;
    run();
  } finally {
    if (previous === undefined) delete process.env.COMMITMENT_CONTROL_PILOT_PAYMENT_LINK_URL;
    else process.env.COMMITMENT_CONTROL_PILOT_PAYMENT_LINK_URL = previous;
  }
}

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}
