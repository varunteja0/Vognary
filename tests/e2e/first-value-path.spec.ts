import { expect, test, type Page } from "@playwright/test";

const receiptEvidence = [
  "OpenAI invoice paid INR 1,999 on 2026-07-06. ChatGPT Plus renews monthly.",
  "Notion invoice paid INR 830 on 2026-07-01. Notion Plus renews monthly.",
].join("\n\n");

const assistedAuditOffer = {
  id: "assisted-private-audit",
  version: 1,
  termsVersion: "terms-2026-07-13",
  amountMinor: 99_900,
  currency: "INR",
};

test("the landing page makes the real audit the single primary path", async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await page.goto("/");

  const primary = page.getByRole("link", { name: "Audit my recurring spend" });
  await expect(primary).toBeVisible();
  await expect(primary).toHaveAttribute("href", "/app");
  await expect(page.getByRole("link", { name: "See a sample audit" })).toHaveAttribute("href", "#product-ledger");
  await expect(page.locator('a[href*="demo="], a[href*="guest="]')).toHaveCount(0);
  expect(failures).toEqual([]);
});

test("two pasted receipts produce one proof-backed first result without login", async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/app");

  const initial = await pageMetrics(page);
  expect(initial.visibleControls).toBeLessThanOrEqual(10);
  expect(initial.scrollHeight).toBeLessThanOrEqual(812 * 2.5);
  expect(initial.horizontalOverflow).toBe(false);
  await expect(page.getByRole("heading", { name: "Know what renews before it charges" })).toBeVisible();
  await expect(page.getByLabel("Paste receipts or invoices")).toBeVisible();
  await expect(page.getByText("Connector catalog")).toHaveCount(0);
  await expect(page.getByText("Verified savings")).toHaveCount(0);
  await expect(page.getByText("Proof graph", { exact: false })).toHaveCount(0);
  await expect(page.getByText(/Import statement|Choose statement files/i)).toHaveCount(0);

  const startedAt = await page.evaluate(() => performance.now());
  await page.getByLabel("Paste receipts or invoices").fill(receiptEvidence);
  const result = page.getByRole("region", { name: "Your first audit result" });
  await expect(result).toBeVisible();
  const resultAt = await page.evaluate(() => performance.now());
  expect(resultAt - startedAt).toBeLessThan(1_000);

  await expect(result.getByText("₹2,829")).toBeVisible();
  await expect(result.getByText("Next renewal", { exact: true })).toBeVisible();
  await expect(result.getByText("Do this first", { exact: true })).toBeVisible();
  await expect(result.getByText("Proof", { exact: true })).toBeVisible();
  await expect(result.getByText(/Pasted receipt/i)).toBeVisible();
  await expect(result.getByRole("link", { name: "Request private audit" })).toHaveAttribute("href", "/private-audit");
  await expect(result.getByRole("link", { name: "Save this audit" })).toHaveAttribute("href", "/login?next=/app");

  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: width < 700 ? 812 : 900 });
    const responsive = await pageMetrics(page);
    expect(responsive.horizontalOverflow, `result overflowed at ${width}px`).toBe(false);
  }

  await page.context().setOffline(true);
  await expect(page.getByText(/Offline: paste and manual entry work/i)).toBeVisible();
  await page.context().setOffline(false);
  await expect(page.getByText(/Offline: paste and manual entry work/i)).toHaveCount(0);

  expect(new URL(page.url()).searchParams.has("item")).toBe(false);
  const transferKey = "vognary.guest-audit-transfer.v1";
  const stagedBeforeLogin = await page.evaluate((key) => sessionStorage.getItem(key), transferKey);
  expect(stagedBeforeLogin).toContain("OpenAI invoice");
  await page.reload();
  await expect(page.getByLabel("Paste receipts or invoices")).toHaveValue(receiptEvidence);
  await expect(page.getByRole("region", { name: "Your first audit result" })).toBeVisible();
  let sessionChecks = 0;
  await page.route("**/api/auth/session", async (route) => {
    sessionChecks += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ authenticated: false, configuration: { status: "ready", cookieName: "vognary_session" }, session: null }),
    });
  });
  await page.getByRole("region", { name: "Your first audit result" }).getByRole("link", { name: "Save this audit" }).click();
  await expect(page).toHaveURL(/\/login\?next=%2Fapp$|\/login\?next=\/app$/);
  await expect.poll(() => sessionChecks).toBeGreaterThanOrEqual(1);
  expect(page.url()).not.toContain("OpenAI");
  expect(await page.evaluate((key) => sessionStorage.getItem(key), transferKey)).toBe(stagedBeforeLogin);
  const checksBeforeFocus = sessionChecks;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => sessionChecks).toBeGreaterThan(checksBeforeFocus);
  expect(failures).toEqual([]);
});

test("the sample audit is clearly labelled, reversible, and never staged as user data", async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await page.goto("/app");

  await page.getByRole("button", { name: "See a sample audit" }).click();
  await expect(page.getByText("Sample audit.", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Your first audit result" })).toBeVisible();
  await expect.poll(async () => (await page.getByLabel("Paste receipts or invoices").inputValue()).split(/\n\s*\n/).filter(Boolean).length).toBe(8);
  await expect(page.getByRole("button", { name: "Clear sample" }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("vognary.guest-audit-transfer.v1"))).toBeNull();

  await page.getByRole("button", { name: "Clear sample" }).first().click();
  await expect(page.getByRole("region", { name: "Your first audit result" })).toHaveCount(0);
  await expect(page.getByLabel("Paste receipts or invoices")).toHaveValue("");
  expect(failures).toEqual([]);
});

test("private audit intake immediately gives a safe source plan and continuation", async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await page.route("**/api/audit-intake", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "accepted", persisted: true, storage: "database", leadId: "11111111-1111-4111-8111-111111111111" }),
    });
  });
  await page.route("**/api/checkout?plan=assisted-audit", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ status: "not-configured" }),
  }));

  await page.goto("/private-audit");
  await expect(page.getByText("INR 4,999")).toHaveCount(0);
  await expect(page.getByText(/Pay for the audit|payment link/i)).toHaveCount(0);
  await page.getByPlaceholder("Your name").fill("First Value Probe");
  await page.getByPlaceholder("you@example.com").fill("probe@example.com");
  await page.getByText("You can contact me about this private audit.").click();
  await page.getByRole("button", { name: "Request private audit" }).click();

  const plan = page.getByRole("region", { name: "Your redaction-first source plan" });
  await expect(plan).toBeVisible();
  await expect(plan.getByText(/Start with/i)).toBeVisible();
  await expect(plan.getByText(/Never share passwords, OTPs, CVV/i)).toBeVisible();
  await expect(plan.getByRole("link", { name: "Continue my audit" })).toHaveAttribute("href", "/app");
  await expect(page.getByText(/will reply with the safest minimum source/i)).toHaveCount(0);
  await expect(page.getByText(/Online payment is not activated|Payment status could not/i)).toHaveCount(0);
  expect(failures).toEqual([]);
});

test("tracked assisted-audit checkout appears only for the exact server offer and binds the durable lead", async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  const leadId = "11111111-1111-4111-8111-111111111111";
  await page.route("**/api/audit-intake", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ status: "accepted", persisted: true, storage: "database", leadId }),
  }));
  await page.route("**/api/checkout?plan=assisted-audit", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      status: "ready",
      plan: "assisted-audit",
      offerId: assistedAuditOffer.id,
      offerVersion: assistedAuditOffer.version,
      termsVersion: assistedAuditOffer.termsVersion,
      provider: "razorpay",
      settlementTracking: true,
      amountMinor: assistedAuditOffer.amountMinor,
      currency: assistedAuditOffer.currency,
      requiredEnv: [],
    }),
  }));

  let checkoutRequest: { headers: Record<string, string>; body: Record<string, unknown> } | null = null;
  await page.route("**/api/checkout", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    checkoutRequest = {
      headers: route.request().headers(),
      body: route.request().postDataJSON() as Record<string, unknown>,
    };
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ready",
        checkoutId: "22222222-2222-4222-8222-222222222222",
        paymentUrl: "https://pay.example/assisted-audit",
        settlementTracking: true,
      }),
    });
  });
  await page.route("https://pay.example/assisted-audit", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<!doctype html><title>Tracked checkout handoff</title><h1>Tracked checkout handoff</h1>",
  }));

  await page.goto("/private-audit");
  await page.getByPlaceholder("Your name").fill("Checkout Probe");
  await page.getByPlaceholder("you@example.com").fill("probe@example.com");
  await page.getByText("You can contact me about this private audit.").click();
  await page.getByRole("button", { name: "Request private audit" }).click();

  const checkout = page.getByRole("region", { name: "Assisted audit checkout" });
  await expect(checkout).toBeVisible();
  await expect(checkout.getByText(/INR 999/)).toBeVisible();
  await expect(checkout.getByText(/does not auto-renew/i)).toBeVisible();
  await expect(checkout.getByRole("button", { name: "Pay for this audit" })).toBeDisabled();
  await checkout.getByRole("checkbox").check();
  await checkout.getByRole("button", { name: "Pay for this audit" }).click();
  await expect(page).toHaveURL("https://pay.example/assisted-audit");

  if (!checkoutRequest) throw new Error("The checkout POST was not observed.");
  const observedCheckout = checkoutRequest as { headers: Record<string, string>; body: Record<string, unknown> };
  expect(observedCheckout.headers["idempotency-key"]).toBe(`assisted-audit:${assistedAuditOffer.version}:${leadId}`);
  expect(observedCheckout.body).toEqual({
    plan: "assisted-audit",
    email: "probe@example.com",
    leadId,
    termsVersion: assistedAuditOffer.termsVersion,
  });
  expect(failures).toEqual([]);
});

async function pageMetrics(page: Page) {
  return page.evaluate(() => {
    const visible = (element: Element) => {
      if (element.closest("nextjs-portal") || element.matches(".sr-only:not(:focus)")) return false;
      if (element.closest("details:not([open])") && element.tagName !== "SUMMARY") return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    };
    return {
      visibleControls: [...document.querySelectorAll("button,a,input,textarea,select,summary")].filter(visible).length,
      scrollHeight: document.documentElement.scrollHeight,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
}

function collectRuntimeFailures(page: Page) {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(`page: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  page.on("requestfailed", (request) => {
    const error = request.failure()?.errorText ?? "failed";
    const url = new URL(request.url());
    const headers = request.headers();
    const speculativePrefetch = headers["next-router-prefetch"] === "1" || headers.purpose === "prefetch";
    if (error === "net::ERR_ABORTED" && url.searchParams.has("_rsc") && speculativePrefetch) return;
    if (error === "net::ERR_ABORTED" && request.method() === "GET" && url.pathname === "/api/checkout") return;
    failures.push(`request: ${request.url()} ${error}`);
  });
  return failures;
}
