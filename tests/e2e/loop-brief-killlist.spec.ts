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
  const request = page.locator(".home-scene .sheet");
  await expect(request).toContainText("Model API vendor (placeholder)");
  await expect(request.getByText("INR 4,80,000", { exact: true })).toBeVisible();
  await expect(request.getByText("Assumption", { exact: true })).toBeVisible();
  await expect(request.getByTestId("synthetic-demonstration-label")).toHaveText("Synthetic demonstration");
  await request.getByText("Evidence and policy", { exact: true }).click();
  await expect(request.locator(".money-cited .money-amount").first()).toHaveText("INR 3,20,000");
  await expect(request.locator(".money-cited .money-provenance").first()).toHaveText("2 invoices");
  await expect(page.getByText(/sample audit|customer result|verified saving/i)).toHaveCount(0);
  await expect(page.locator("#product-ledger")).toHaveCount(0);
  await expect(page.getByText(/Vognary caught|founders saved|customers saved/i)).toHaveCount(0);
});
