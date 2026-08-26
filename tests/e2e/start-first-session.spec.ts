import { expect, test } from "@playwright/test";

test("an unauthenticated first session can paste a bill and see cited evidence before Google", async ({ page }) => {
  await page.goto("/start");
  await expect(page.getByRole("heading", { name: "See the charge. Sign in to authorize." })).toBeVisible();
  await expect(page.getByText(/Nothing is saved until you sign in/)).toBeVisible();
  await page.getByLabel("Or paste the receipt").fill([
    "Cursor",
    "Invoice paid USD 20.00",
    "Payment date: 28 August 2026",
    "Cursor Pro renews monthly on 28 September 2026.",
  ].join("\n"));
  await page.getByRole("button", { name: "Cite this bill" }).click();
  await expect(page.getByRole("heading", { name: /^Cursor · \$20\.00$/ })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Cursor charges \$20\.00\. Charges in/i)).toHaveCount(0);
  await expect(page.getByText("From your receipt", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Plan to cancel" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Sign in to remember this evidence" })).toHaveAttribute("href", "/login?next=/app");
  await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
});
