import { expect, test } from "@playwright/test";

/**
 * Core loop surfaces: first-result metrics, assistant brief, and UPI mandate
 * kill-list from statement-shaped evidence — without login.
 */
const indiaMandateReceipts = [
  "NETFLIX.COM UPI-AUTOPAY MANDATE debited INR 649 on 2026-07-05. Netflix Premium renews monthly.",
  "SPOTIFY PREMIUM UPI AUTOPAY Rs 119 on 05/07/2026. Your subscription renews monthly via PhonePe.",
  "OpenAI invoice paid INR 1,999 on 2026-07-06. ChatGPT Plus renews monthly.",
].join("\n\n");

test("guest paste surfaces first result, brief, and mandate kill-list", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app");

  await page.getByLabel("Paste receipts or invoices").fill(indiaMandateReceipts);

  const firstResult = page.getByRole("region", { name: "Your first audit result" });
  await expect(firstResult).toBeVisible({ timeout: 10_000 });
  await expect(firstResult.getByText("Monthly burn", { exact: true })).toBeVisible();
  await expect(firstResult.getByText("Do this first", { exact: true })).toBeVisible();
  await expect(firstResult.getByText("Proof", { exact: true })).toBeVisible();

  const brief = page.getByRole("region", { name: "Your brief" });
  await expect(brief).toBeVisible();
  await expect(brief.locator("h2")).not.toBeEmpty();

  // Kill-list only renders when mandate tokens are present in evidence.
  const killList = page.getByRole("region", { name: "Auto-debit mandate kill-list" });
  await expect(killList).toBeVisible();
  await expect(killList.getByText(/UPI AutoPay|mandate/i).first()).toBeVisible();
  await expect(killList.getByText(/Matched/i).first()).toBeVisible();
});

test("landing sample ledger is explicitly labelled illustrative", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "See a sample audit" }).click();
  const sample = page.locator("#product-ledger");
  await expect(sample).toBeVisible();
  await expect(sample.getByText(/illustrative sample|Sample audit output/i).first()).toBeVisible();
  await expect(sample.getByText(/not live output/i)).toBeVisible();
});
