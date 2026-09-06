import { expect, test } from "@playwright/test";
test("manual financial evidence is not exposed before sign-in", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app");

  await expect(page).toHaveURL(/\/login\?next=(?:%2F|\/)app$/);
  await expect(page.getByLabel("Paste receipts or invoices")).toHaveCount(0);
  await expect(page.getByText(/UPI AutoPay|mandate kill-list/i)).toHaveCount(0);
});

test("landing walkthrough is explicitly illustrative and never presented as customer proof", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Vognary", level: 1 })).toBeVisible();
  // The example amount is on the page and is labelled an assumption, not proof.
  const proposed = page.locator(".sheet").first();
  await expect(proposed).toContainText("Model API vendor (placeholder)");
  await expect(proposed.locator(".money-assumed .money-amount").first()).toHaveText("INR 4,80,000");
  await expect(proposed.locator(".money-assumed .money-provenance").first()).toHaveText("Assumption");
  // It says what it is, in visible text, on the same object as the figures.
  await expect(page.getByTestId("synthetic-demonstration-label").first()).toHaveText("Synthetic demonstration");
  await expect(page.getByText(/sample audit|customer result|verified saving/i)).toHaveCount(0);
  await expect(page.locator("#product-ledger")).toHaveCount(0);
  await expect(page.getByText(/Vognary caught|founders saved|customers saved/i)).toHaveCount(0);
});
