import assert from "node:assert/strict";
import test from "node:test";
import { findActionableCancelAction, findCancelAction, manageUrlHostname, normalizeMerchantKey } from "../src/lib/cancel-actions";

test("known merchants resolve to their own manage surface", () => {
  const netflix = findCancelAction("Netflix");
  assert.equal(netflix?.merchantLabel, "Netflix");
  assert.equal(manageUrlHostname(netflix!), "www.netflix.com");

  const adobe = findCancelAction("Adobe Creative Cloud");
  assert.equal(adobe?.merchantLabel, "Adobe");
  assert.ok(adobe?.caveat?.includes("early-termination"));
});

test("statement-style descriptors still match", () => {
  assert.equal(findCancelAction("NETFLIX.COM Mumbai")?.merchantLabel, "Netflix");
  assert.equal(findCancelAction("AMAZON PRIME MEMBERSHIP")?.merchantLabel, "Amazon Prime");
  assert.equal(findCancelAction("GOOGLE *YouTubePremium")?.merchantLabel, "YouTube Premium");
  assert.equal(findCancelAction("OPENAI *CHATGPT SUBSCR")?.merchantLabel, "OpenAI / ChatGPT");
});

test("LinkedIn Premium never matches Amazon Prime", () => {
  assert.equal(findCancelAction("LinkedIn Premium")?.merchantLabel, "LinkedIn Premium");
});

test("JioHotstar resolves to Hotstar, not the Jio telecom entry", () => {
  assert.equal(findCancelAction("JioHotstar")?.merchantLabel, "JioHotstar");
});

test("category fallbacks cover India rails when the merchant is unknown", () => {
  const mandate = findCancelAction("Unknown Gym", "Mandates");
  assert.equal(mandate?.kind, "rail-guide");
  assert.ok(mandate?.steps.some((step) => step.includes("UPI app")));

  const insurance = findCancelAction("Unknown Insurer", "Insurance");
  assert.equal(insurance?.kind, "rail-guide");
  assert.ok(insurance?.steps[0].includes("Do not simply stop paying"));

  const appStore = findCancelAction("Some Game", "App store");
  assert.equal(appStore?.kind, "platform");
});

test("merchant match wins over the category fallback", () => {
  const action = findCancelAction("Netflix", "App store");
  assert.equal(action?.merchantLabel, "Netflix");
});

test("unknown merchant with unknown category returns null, never an invented action", () => {
  assert.equal(findCancelAction("Totally Unknown Vendor"), null);
  assert.equal(findCancelAction("Totally Unknown Vendor", "Streaming"), null);
  assert.equal(findCancelAction(""), null);
});

test("every linked action uses an https URL on a parseable hostname and has steps", () => {
  const merchants = [
    "Netflix", "Spotify", "YouTube", "Amazon Prime", "Hotstar", "Apple.com", "Google Play",
    "OpenAI", "Claude", "GitHub", "AWS", "Vercel", "Render", "Cloudflare", "DigitalOcean",
    "Adobe", "Canva", "Notion", "Figma", "Slack", "Zoom", "LinkedIn", "X Premium", "GoDaddy",
    "Namecheap", "Hostinger", "Microsoft 365", "Dropbox", "Grammarly", "Cursor", "Perplexity",
    "Airtel", "Jio",
  ];
  for (const merchant of merchants) {
    const action = findCancelAction(merchant);
    assert.ok(action, `expected registry coverage for ${merchant}`);
    assert.ok(action!.steps.length >= 1, `${merchant} must ship steps`);
    if (action!.manageUrl) {
      assert.ok(action!.manageUrl.startsWith("https://"), `${merchant} URL must be https`);
      assert.ok(manageUrlHostname(action!), `${merchant} URL must parse`);
    }
  }
});

test("the actionable gate never shows a cancel path under keep or watch", () => {
  assert.ok(findActionableCancelAction("Netflix", "Streaming", "cancel"));
  assert.ok(findActionableCancelAction("Netflix", "Streaming", "downgrade"));
  assert.ok(findActionableCancelAction("Netflix", "Streaming", "investigate"));
  assert.equal(findActionableCancelAction("Netflix", "Streaming", "watch"), null);
  assert.equal(findActionableCancelAction("Netflix", "Streaming", "keep"), null);
});

test("a recognizable service beats its payment rail; bare PayPal descriptors get autopay guidance", () => {
  assert.equal(findCancelAction("PAYPAL *SPOTIFY")?.merchantLabel, "Spotify");
  const bare = findCancelAction("PAYPAL RECURRING PAYMENT");
  assert.equal(bare?.merchantLabel, "PayPal automatic payments");
  assert.equal(manageUrlHostname(bare!), "www.paypal.com");
});

test("normalization strips separators and case", () => {
  assert.equal(normalizeMerchantKey("X Premium (x.com)"), "xpremiumxcom");
  assert.equal(normalizeMerchantKey("  NETFLIX.COM  "), "netflixcom");
});
