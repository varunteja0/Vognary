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

  await expect(page.getByRole("heading", { name: "See what your company is about to pay. Decide before the card fires." })).toBeVisible();
  await expect(page.getByText(/Cursor Pro charges ₹1,700\.00/)).toBeVisible();
  await expect(page.getByText("From the example receipt", { exact: true })).toBeVisible();
  await expect(page.getByText(/Illustrative walkthrough, not a claim about your company/)).toBeVisible();
  await expect(page.getByText(/sample audit|customer result|verified saving/i)).toHaveCount(0);
  await expect(page.locator("#product-ledger")).toHaveCount(0);
  await expect(page.getByText(/Vognary caught|founders saved|customers saved/i)).toHaveCount(0);
});
