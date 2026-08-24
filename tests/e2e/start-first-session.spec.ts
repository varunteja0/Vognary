import { expect, test } from "@playwright/test";

test("an unauthenticated first session can paste a bill and see a spoken decision before Google", async ({ page }) => {
  await page.goto("/start");
  await expect(page.getByRole("heading", { name: "See the charge. Make the decision." })).toBeVisible();
  await expect(page.getByText(/Nothing is saved until you sign in/)).toBeVisible();
  await page.getByLabel("Or paste the receipt").fill([
    "Cursor",
    "Invoice paid USD 20.00",
    "Payment date: 28 August 2026",
    "Cursor Pro renews monthly on 28 September 2026.",
  ].join("\n"));
  await page.getByRole("button", { name: "Check this bill" }).click();
  await expect(page.getByText(/Cursor charges/i)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("From your receipt", { exact: true })).toBeVisible();
  await expect(page.getByText("Why now", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Plan to cancel" })).toBeVisible();
  await page.getByRole("button", { name: "Plan to cancel" }).click();
  await expect(page.getByRole("heading", { name: "Cursor — plan to cancel" })).toBeVisible();
  await expect(page.getByText(/Sign in to remember this plan/)).toBeVisible();
  await expect(page.getByText(/Sign in to save this decision and have Vognary check the next bill/)).toBeVisible();
  // The hook names the calendar date from the bill, not a spoken relative phrase.
  await expect(page.getByText(/will then watch around 28 Sept 2026/)).toBeVisible();
  await expect(page.getByText(/watch around Charges in/)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Sign in to remember this decision" })).toHaveAttribute("href", "/login?next=/app");
  await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
});
