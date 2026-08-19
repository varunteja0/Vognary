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

  await expect(page.getByRole("heading", { name: "Decide before the charge, not after it." })).toBeVisible();
  await expect(page.getByText("What is due next", { exact: true })).toBeVisible();
  await expect(page.getByText("Why it deserves a look", { exact: true })).toBeVisible();
  await expect(page.getByText("What happened after you decided", { exact: true })).toBeVisible();
  await expect(page.getByText(/sample audit|illustrative sample|not live output/i)).toHaveCount(0);
  await expect(page.locator("#product-ledger")).toHaveCount(0);
  // No money may appear before a visitor has cited a single receipt, labelled
  // as an example or otherwise.
  await expect(page.getByText(/[\u20b9$€£]\s?\d/)).toHaveCount(0);
});
