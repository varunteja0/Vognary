import { expect, test } from "@playwright/test";

test("an unauthenticated first session can paste a bill and see a spoken decision before Google", async ({ page }) => {
  await page.goto("/start");
  await expect(page.getByRole("heading", { name: "Add a bill." })).toBeVisible();
  await expect(page.getByText(/Nothing is saved until you sign in/)).toBeVisible();
  await page.getByLabel("Or paste the receipt text").fill([
    "Cursor",
    "Invoice paid USD 20.00",
    "Payment date: 28 August 2026",
    "Cursor Pro renews monthly on 28 September 2026.",
  ].join("\n"));
  await page.getByRole("button", { name: "See the decision" }).click();
  await expect(page.getByText(/Cursor charges/i)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Keep", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Plan to cancel" })).toBeVisible();
  await page.getByRole("button", { name: "Plan to cancel" }).click();
  await expect(page.getByText(/plan to cancel is recorded/i)).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in to remember this" })).toHaveAttribute("href", "/login?next=/app");
  await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
});
