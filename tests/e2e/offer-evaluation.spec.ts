import { expect, test } from "@playwright/test";

test("evaluation entry, pilot terms, sign-in and support distinguish the only approved purchase", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByText("Commitment Control for India-first AI companies", { exact: true })).toBeVisible();
  await expect(page.getByText("The bill-review example is an evaluation, not a separate purchased service.")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("control-proposition.png"), fullPage: true });
  await page.getByRole("link", { name: "Try a spending decision", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review a commitment.", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Approve with a lower cap" }).click();
  await page.getByRole("button", { name: /Let the September invoice arrive/ }).click();
  await expect(page.getByText(/over cap/i).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "See the one-month pilot", exact: true })).toHaveAttribute("href", "/pay");
  await expect(page.getByRole("link", { name: "Use your own evidence", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Try the bill-review example", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Supplier bill review", exact: true })).toBeVisible();
  await expect(page.getByText(/The paid offer remains the separate/)).toBeVisible();
  await page.getByRole("link", { name: "Commitment Control pilot", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Commitment Control private pilot", exact: true })).toBeVisible();
  await expect(page.getByText(/not a managed bill-review service/)).toBeVisible();
  await expect(page.getByText("INR 14,999", { exact: true })).toBeVisible();
  await expect(page.getByText("Requires a separate active purchase", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Request the one-time invoice" })).toHaveAttribute("href", /^mailto:/);
  await page.screenshot({ path: testInfo.outputPath("approved-pilot-terms.png"), fullPage: true });
  await page.goto("/login?next=%2Fapp%3Fview%3DBILL_REVIEW");
  await expect(page.getByText(/Sign-in is not pilot activation/)).toBeVisible();
  await page.goto("/contact");
  await expect(page.getByText(/The bill-review example is a separate synthetic evaluation/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test("public bill-example links describe fixed synthetic input, including the menu and footer", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("contentinfo").getByRole("link", { name: "Try the bill-review example", exact: true })).toHaveAttribute("href", "/start");
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  const menu = page.getByRole("dialog", { name: "Site menu" });
  await expect(menu.getByText("A fixed synthetic bill change, separate from the paid pilot")).toBeVisible();
  await menu.getByRole("link", { name: /Try the bill-review example/ }).click();
  await expect(page.getByRole("heading", { name: "Supplier bill review", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Continue to your bill desk", exact: true })).toHaveAttribute("href", "/login?next=%2Fapp%3Fview%3DBILL_REVIEW");
});

test("invoice fallback copies the contact address without claiming a sent request", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/pay");
  const copy = page.getByRole("button", { name: "Copy invoice email address" });
  await copy.click();
  await expect(page.getByRole("status")).toHaveText("Email address copied. No request has been sent.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("support@vognary.com");
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: async () => { throw new DOMException("Synthetic clipboard denial", "NotAllowedError"); },
    });
  });
  await copy.click();
  await expect(page.getByRole("status")).toHaveText("Copy unavailable. Email support@vognary.com. No request has been sent.");
  await expect(page.getByRole("link", { name: "Request the one-time invoice" })).toHaveAttribute("href", /^mailto:support@vognary\.com/);
});

test("a synthetic paid confirmation does not grant activation or sell bill review", async ({ page }) => {
  const checkoutId = "11111111-1111-4111-8111-111111111111";
  await page.route(`**/api/checkout/${checkoutId}`, route => route.fulfill({ json: { status: "paid", plan: "commitment-control-private-pilot", currency: "INR", amountMinor: 1499900, paidAt: "2026-09-07T00:00:00.000Z", refundedAt: null } }));
  await page.goto(`/billing/return?checkout=${checkoutId}`);
  await expect(page.getByText(/Payment does not activate customer data/)).toBeVisible();
  await expect(page.getByText(/independent assessment, remediation and retest/)).toBeVisible();
  await expect(page.getByText(/Another month requires a separate purchase/)).toBeVisible();
});
