import { expect, test, type Page } from "@playwright/test";

const assistedAuditOffer = {
  id: "assisted-private-audit",
  version: 1,
  termsVersion: "terms-2026-07-13",
  amountMinor: 99_900,
  currency: "INR",
};

test("the first-value path leads into the product with assisted audit as a secondary option", async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await page.goto("/");

  const primary = page.locator("section").filter({ has: page.getByRole("heading", { name: "Know which software is worth paying for before you pay again." }) })
    .getByRole("link", { name: "Review my software stack", exact: true });
  await expect(primary).toBeVisible();
  await expect(primary).toHaveAttribute("href", "/login?next=/app");
  await primary.click();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Know which software is worth paying for" })).toBeVisible();

  await page.goto("/");
  const assisted = page.getByRole("link", { name: "Request a private audit", exact: true });
  await expect(assisted).toHaveAttribute("href", "/private-audit");
  await assisted.click();
  await expect(page).toHaveURL(/\/private-audit$/);
  await expect(page.getByRole("heading", { name: /Prove what renews/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Request private audit" })).toBeVisible();
  await expect(page.getByText(/sample audit/i)).toHaveCount(0);
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
  await expect(plan.getByRole("link", { name: "Sign in to Vognary" })).toHaveAttribute("href", "/login?next=/app");
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

function collectRuntimeFailures(page: Page) {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(`page: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  page.on("requestfailed", (request) => {
    const error = request.failure()?.errorText ?? "failed";
    const url = new URL(request.url());
    if (error === "net::ERR_ABORTED" && request.method() === "GET" && url.searchParams.has("_rsc")) return;
    if (error === "net::ERR_ABORTED" && request.method() === "GET" && url.pathname === "/api/checkout") return;
    if (error === "net::ERR_ABORTED" && request.method() === "GET" && url.pathname === "/api/auth/session") return;
    failures.push(`request: ${request.url()} ${error}`);
  });
  return failures;
}
