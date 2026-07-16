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

test("India consumer merchants resolve to their own entries", () => {
  const expectations: Array<[string, string]> = [
    ["SWIGGY ONE", "Swiggy One"],
    ["BUNDL TECHNOLOGIES", "Swiggy One"],
    ["ZOMATO GOLD", "Zomato Gold"],
    ["ETERNAL LIMITED", "Zomato Gold"],
    ["SONYLIV", "SonyLIV"],
    ["ZEE5", "ZEE5"],
    ["SUN NXT", "Sun NXT"],
    ["HOICHOI", "hoichoi"],
    ["GOOGLE *DISCOVERYPLUS", "discovery+"],
    ["CRUNCHYROLL", "Crunchyroll"],
    ["AUDIBLE", "Audible"],
    ["KINDLE UNLIMITED", "Kindle Unlimited"],
    ["CULT.FIT", "Cult.fit"],
    ["CUREFIT", "Cult.fit"],
    ["HEADSPACE", "Headspace"],
    ["ATRIA CONVERGENCE TECHNOLOGIES", "ACT Fibernet"],
    ["EXCITEL BROADBAND", "Excitel"],
    ["DISH TV INDIA", "Dish TV"],
    ["VIDEOCON D2H", "d2h"],
    ["BSNL", "BSNL Bharat Fiber"],
    ["UBER *ONE", "Uber One"],
    ["THE KEN", "The Ken"],
    ["LIVEMINT", "Mint Premium"],
    ["MONEYCONTROL PRO", "Moneycontrol Pro"],
    ["NORDVPN", "NordVPN"],
    ["SQUARESPACE", "Squarespace"],
  ];
  for (const [descriptor, label] of expectations) {
    assert.equal(findCancelAction(descriptor)?.merchantLabel, label, descriptor);
  }
});

test("all 70 researched cancel-path entries are reachable", () => {
  const expectations: Array<[string, string]> = [
    ["XBOX GAME PASS", "Xbox Game Pass"],
    ["PLAYSTATION PLUS", "PlayStation Plus"],
    ["MSFT ONEDRIVE", "OneDrive"],
    ["MICROSOFT COPILOT PRO", "Microsoft Copilot Pro"],
    ["SWIGGY ONE", "Swiggy One"],
    ["ZOMATO GOLD", "Zomato Gold"],
    ["UBER ONE", "Uber One"],
    ["SONYLIV", "SonyLIV"],
    ["ZEE5", "ZEE5"],
    ["JIOSAAVN", "JioSaavn Pro"],
    ["AUDIBLE", "Audible"],
    ["KINDLE UNLIMITED", "Kindle Unlimited"],
    ["SUN NXT", "Sun NXT"],
    ["AHA VIDEO", "aha"],
    ["HOICHOI", "hoichoi"],
    ["DISCOVERY PLUS", "discovery+"],
    ["LIONSGATE PLAY", "Lionsgate Play"],
    ["MUBI", "MUBI"],
    ["CRUNCHYROLL", "Crunchyroll"],
    ["GAANA", "Gaana Plus"],
    ["STORYTEL", "Storytel"],
    ["GOOGLE ONE", "Google One"],
    ["1PASSWORD", "1Password"],
    ["NORDVPN", "NordVPN"],
    ["EXPRESSVPN", "ExpressVPN"],
    ["SURFSHARK", "Surfshark"],
    ["NORTON 360", "Norton 360"],
    ["MCAFEE", "McAfee"],
    ["EVERNOTE", "Evernote"],
    ["TODOIST", "Todoist"],
    ["PROTON MAIL", "Proton"],
    ["MIDJOURNEY", "Midjourney"],
    ["ELEVENLABS", "ElevenLabs"],
    ["RUNWAY AI", "Runway"],
    ["SHOPIFY", "Shopify"],
    ["WEBFLOW", "Webflow"],
    ["ZOHO ONE", "Zoho"],
    ["MAILCHIMP", "Mailchimp"],
    ["SEMRUSH", "Semrush"],
    ["WIX.COM", "Wix"],
    ["SQUARESPACE", "Squarespace"],
    ["CULT.FIT", "Cult.fit"],
    ["HEALTHIFYME", "HealthifyMe"],
    ["HEADSPACE", "Headspace"],
    ["CALM PREMIUM", "Calm"],
    ["STRAVA", "Strava"],
    ["MYFITNESSPAL", "MyFitnessPal"],
    ["FLO PREMIUM", "Flo Premium"],
    ["ET PRIME", "ET Prime"],
    ["TOI PLUS", "TOI+"],
    ["BUSINESS STANDARD", "Business Standard Digital"],
    ["MONEYCONTROL PRO", "Moneycontrol Pro"],
    ["THE KEN", "The Ken"],
    ["THE MORNING CONTEXT", "The Morning Context"],
    ["THE HINDU DIGITAL", "The Hindu Digital"],
    ["THE INDIAN EXPRESS DIGITAL", "The Indian Express Digital"],
    ["MINT PREMIUM", "Mint Premium"],
    ["TINDER", "Tinder"],
    ["BUMBLE", "Bumble"],
    ["JIOFIBER", "JioFiber"],
    ["AIRTEL XSTREAM FIBER", "Airtel Xstream Fiber"],
    ["ACT FIBERNET", "ACT Fibernet"],
    ["TATA PLAY BINGE", "Tata Play Binge"],
    ["TATA PLAY", "Tata Play"],
    ["DISH TV", "Dish TV"],
    ["VIDEOCON D2H", "d2h"],
    ["EXCITEL", "Excitel"],
    ["HATHWAY", "Hathway"],
    ["BSNL BHARAT FIBER", "BSNL Bharat Fiber"],
    ["PAYPAL RECURRING PAYMENT", "PayPal automatic payments"],
  ];
  assert.equal(expectations.length, 70);
  for (const [descriptor, label] of expectations) {
    const action = findCancelAction(descriptor);
    assert.equal(action?.merchantLabel, label, descriptor);
    assert.ok(action.steps.length >= 1, `${label} must ship cancellation steps`);
  }
});

test("specific entries beat the generic telecom, Microsoft, and Google Play entries", () => {
  assert.equal(findCancelAction("JIOSAAVN")?.merchantLabel, "JioSaavn Pro");
  assert.equal(findCancelAction("JIOFIBER")?.merchantLabel, "JioFiber");
  assert.equal(findCancelAction("RELIANCE JIO")?.merchantLabel, "Jio");
  assert.equal(findCancelAction("AIRTEL XSTREAM FIBER")?.merchantLabel, "Airtel Xstream Fiber");
  assert.equal(findCancelAction("BHARTI AIRTEL")?.merchantLabel, "Airtel");
  assert.equal(findCancelAction("TATA PLAY BINGE")?.merchantLabel, "Tata Play Binge");
  assert.equal(findCancelAction("TATA PLAY")?.merchantLabel, "Tata Play");
  assert.equal(findCancelAction("MICROSOFT*XBOX")?.merchantLabel, "Xbox Game Pass");
  assert.equal(findCancelAction("MSFT *ONEDRIVE")?.merchantLabel, "OneDrive");
  assert.equal(findCancelAction("MSFT *COPILOT")?.merchantLabel, "Microsoft Copilot Pro");
  assert.equal(findCancelAction("MICROSOFT*MICROSOFT 365")?.merchantLabel, "Microsoft 365");
  assert.equal(findCancelAction("GOOGLE *GOOGLE ONE")?.merchantLabel, "Google One");
  assert.equal(findCancelAction("GOOGLE PLAY APPS")?.merchantLabel, "Google Play subscriptions");
  assert.equal(findCancelAction("GITHUB COPILOT")?.merchantLabel, "GitHub");
});

test("substring patterns stay conservative: unrelated Indian merchants match nothing", () => {
  assert.equal(findCancelAction("MAHANAGAR GAS"), null);
  assert.equal(findCancelAction("CHAAYOS"), null);
  assert.equal(findCancelAction("MUMBAI METRO"), null);
});

test("every India-expansion linked action uses an https URL and ships steps", () => {
  const linked = [
    "Audible", "Kindle Unlimited", "Crunchyroll", "Xbox Game Pass", "PlayStation Plus",
    "Google One", "NordVPN", "ExpressVPN", "Surfshark", "Norton 360", "McAfee", "Todoist",
    "Proton Mail", "Midjourney", "ElevenLabs", "Webflow", "Mailchimp", "Wix.com",
    "Squarespace", "Strava", "JioFiber", "BSNL",
  ];
  for (const merchant of linked) {
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
  assert.equal(findCancelAction("PAYPAL *UBER ONE")?.merchantLabel, "Uber One");
  const bare = findCancelAction("PAYPAL RECURRING PAYMENT");
  assert.equal(bare?.merchantLabel, "PayPal automatic payments");
  assert.equal(manageUrlHostname(bare!), "www.paypal.com");
});

test("normalization strips separators and case", () => {
  assert.equal(normalizeMerchantKey("X Premium (x.com)"), "xpremiumxcom");
  assert.equal(normalizeMerchantKey("  NETFLIX.COM  "), "netflixcom");
});
