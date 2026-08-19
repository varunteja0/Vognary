import { expect, test } from "@playwright/test";
test("manual financial evidence is not exposed before sign-in", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app");

  await expect(page).toHaveURL(/\/login\?next=(?:%2F|\/)app$/);
  await expect(page.getByLabel("Paste receipts or invoices")).toHaveCount(0);
  await expect(page.getByText(/UPI AutoPay|mandate kill-list/i)).toHaveCount(0);
});

test("landing contains no sample ledger or illustrative financial totals", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Know what your company is committed to pay next — and what deserves attention before the card fires." })).toBeVisible();
  await expect(page.getByText("What you are committed to", { exact: true })).toBeVisible();
  await expect(page.getByText("What changed, and what is coming", { exact: true })).toBeVisible();
  await expect(page.getByText("What deserves review, and why", { exact: true })).toBeVisible();
  await expect(page.getByText(/sample audit|illustrative sample|not live output/i)).toHaveCount(0);
  await expect(page.locator("#product-ledger")).toHaveCount(0);
});
