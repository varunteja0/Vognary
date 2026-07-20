import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const receiptEvidence = [
  "OpenAI invoice paid INR 1,999 on 2026-07-06. ChatGPT Plus renews monthly.",
  "Notion invoice paid INR 830 on 2026-07-01. Notion Plus renews monthly.",
].join("\n\n");

test("the landing hero performs the audit and hands off to the full audit", async ({ page }) => {
  await page.goto("/");

  const pasteBox = page.getByLabel("Paste a receipt to see it now");
  await expect(pasteBox).toBeVisible();
  await expect(page.getByRole("link", { name: "Audit my recurring spend" })).toBeVisible();

  await pasteBox.fill(receiptEvidence);

  const result = page.getByRole("region", { name: "Instant audit result" });
  await expect(result.getByText("Monthly burn")).toBeVisible();
  await expect(result.getByText("Next renewal")).toBeVisible();
  await expect(result.getByText("Do this first")).toBeVisible();
  await expect(result.getByText(/₹\s?2,829/)).toBeVisible();

  const axe = await new AxeBuilder({ page }).analyze();
  const serious = axe.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  expect(serious).toEqual([]);

  await page.getByRole("button", { name: "Continue in the full audit" }).click();
  await page.waitForURL("**/app**");

  await expect(page.getByRole("heading", { name: "Know what renews before it charges" })).toBeVisible();
  await expect(page.getByLabel("Paste receipts or invoices")).toHaveValue(new RegExp("OpenAI invoice"));
  await expect(page.getByText("Do this first")).toBeVisible();
});

test("the sample receipt chip produces a labelled result without typing", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Try a sample receipt" }).click();

  const result = page.getByRole("region", { name: "Instant audit result" });
  await expect(result.getByText("Monthly burn")).toBeVisible();
  await expect(result.getByText("Do this first")).toBeVisible();
  await expect(result.getByRole("button", { name: "Continue in the full audit" })).toBeVisible();
});
