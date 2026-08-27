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
  await expect(page.getByRole("heading", { name: "Cursor" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("$20.00").first()).toBeVisible();
  await expect(page.getByText(/28 Sept? 2026 · in \d+ days/)).toBeVisible();
  await expect(page.getByText(/Cursor charges \$20\.00\. Charges in/i)).toHaveCount(0);
  await expect(page.getByText("From your receipt", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Plan to cancel" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Sign in to remember this evidence" })).toHaveAttribute("href", "/login?next=/app");
  await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
});

test("a Manage Subscription screenshot prefills next billing instead of a paid date", async ({ page }) => {
  await page.goto("/start");
  await page.getByLabel("Upload invoices or receipts").setInputFiles({
    name: "subscription.png",
    mimeType: "image/png",
    buffer: Buffer.from([
      "Manage Subscription",
      "Plan Premium",
      "Status Active",
      "Cost ₹427 / month",
      "Next billing cycle starts on September 20, 2026",
    ].join("\n")),
  });
  await expect(page.getByLabel("Last paid")).toHaveValue("", { timeout: 20_000 });
  await expect(page.getByLabel("Next billing")).toHaveValue("2026-09-20");
  await expect(page.getByLabel("Merchant")).toHaveValue("");
  await expect(page.getByLabel("Amount")).toHaveValue("427");
  await expect(page.getByLabel("Currency")).toHaveValue("INR");
  await expect(page.getByText(/next billing cycle, not a payment/i)).toBeVisible();
  await page.getByLabel("Merchant").fill("X.com");
  await page.getByRole("button", { name: "Confirm this line" }).click();
  await expect(page.getByRole("heading", { name: "X.com" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("₹427.00").first()).toBeVisible();
  await expect(page.getByText(/20 Sept? 2026 · in \d+ days/)).toBeVisible();
  await expect(page.locator("blockquote.decision-quote")).toContainText("X.com next billing INR 427 on 2026-09-20");
  await expect(page.getByText(/invoice paid/i)).toHaveCount(0);
});
