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

  await expect(page.getByRole("heading", { name: "Commitment Control: freeze the cap before the obligation exists." })).toBeVisible();
  // The example amount is on the page and is labelled an assumption, not proof.
  const proposed = page.locator(".decision-sentence");
  await expect(proposed).toContainText("Cursor Pro");
  await expect(proposed.locator(".money-amount")).toHaveText("INR 1,700");
  await expect(proposed.locator(".money-provenance")).toHaveText("Assumption");
  await expect(page.getByText("From two example receipts", { exact: true })).toBeVisible();
  await expect(page.getByText(/Example only\. Your review uses your receipts/)).toBeVisible();
  await expect(page.getByText(/sample audit|customer result|verified saving/i)).toHaveCount(0);
  await expect(page.locator("#product-ledger")).toHaveCount(0);
  await expect(page.getByText(/Vognary caught|founders saved|customers saved/i)).toHaveCount(0);
});
