import { expect, test } from "@playwright/test";

// The canonical first-value chain: landing → Start with my data → guest
// workspace → paste real receipt evidence → proven recurring item with next
// renewal and one recommended action → guest-payable audit CTA. No login at
// any point before the first useful result.
const receiptEvidence = [
  "OpenAI invoice paid INR 1,999 on 2026-07-06. ChatGPT Plus renews monthly.",
  "Notion invoice paid INR 830 on 2026-07-01. Notion Plus renews monthly.",
].join("\n\n");

test("a guest reaches a proven first result and a payable audit CTA from pasted evidence", async ({ page }) => {
  const startedAt = Date.now();

  await page.goto("/");
  await page.getByRole("link", { name: "Start with my data" }).click();
  await expect(page).toHaveURL(/\/app\?guest=1/);
  await expect(page.getByText("Nothing connected yet")).toBeVisible();

  if (test.info().project.name === "mobile-chromium") {
    await page.getByRole("link", { name: "Connect", exact: true }).click();
  }
  const receiptField = page.getByLabel("Receipt, invoice, renewal, or payment-success text");
  await receiptField.scrollIntoViewIfNeeded();
  await receiptField.fill(receiptEvidence);

  if (test.info().project.name === "mobile-chromium") {
    await page.getByRole("link", { name: "Overview", exact: true }).click();
  }

  // First result: monthly burn, the proven merchant, next renewal, and one
  // dominant recommended action.
  const overview = page.locator("#overview");
  await expect(overview.getByText("Monthly burn", { exact: true })).toBeVisible();
  await expect(overview.getByText("₹2,829").first()).toBeVisible();
  await expect(overview.getByText("Renews next", { exact: true })).toBeVisible();
  await expect(overview.getByText("Do this first", { exact: true })).toBeVisible();

  // The guest-payable next step is the private audit, not a login wall.
  const auditCta = overview.getByRole("link", { name: "Get a private audit" });
  await expect(auditCta).toBeVisible();
  await expect(auditCta).toHaveAttribute("href", "/private-audit");

  // Proof and missing-source honesty stay visible without burying the action.
  await expect(overview.getByText("Proof strength", { exact: true })).toBeVisible();
  await expect(overview.getByText("Verified savings", { exact: true })).toBeVisible();

  const elapsedMs = Date.now() - startedAt;
  test.info().annotations.push({ type: "first-value-ms", description: String(elapsedMs) });
  expect(elapsedMs).toBeLessThan(180_000);
});

test("the private audit page is reachable and submits without login", async ({ page }) => {
  await page.goto("/private-audit");
  await expect(page.getByRole("heading", { name: /Prove what renews/ })).toBeVisible();
  await page.getByPlaceholder("Your name").fill("First Value Probe");
  await page.getByPlaceholder("you@example.com").fill(`probe-${Date.now()}@example.com`);
  await page.getByText("You can contact me about this private audit.").click();
  await page.getByRole("button", { name: "Request private audit" }).click();
  await expect(page.getByText(/Audit request received|Request prepared/)).toBeVisible();
});
