import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("the landing demonstrates the decision loop and sends visitors to their own bill", async ({ page }) => {
  await page.goto("/");

  const heading = page.getByRole("heading", { level: 1, name: "See what your company is about to pay. Decide before the card fires." });
  const hero = page.locator("section").filter({ has: heading });
  await expect(heading).toBeVisible();
  await expect(page.getByText(/Receipt forwarding is not active in this deployment/)).toHaveCount(0);

  const getStarted = hero.getByRole("link", { name: "Review one bill", exact: true });
  const signIn = page.getByRole("navigation", { name: "Public" }).getByRole("link", { name: "Sign in", exact: true });
  await expect(getStarted).toHaveAttribute("href", "/start");
  await expect(signIn).toHaveAttribute("href", "/login?next=/app");

  await expect(page.getByText(/No account to start\. No bank password\. No mailbox access\./)).toBeVisible();
  await expect(page.getByRole("heading", { name: "See Vognary do the work." })).toBeVisible();
  await expect(page.getByText("From the example receipt", { exact: true })).toBeVisible();
  await expect(page.getByText(/Illustrative walkthrough, not a claim about your company/)).toBeVisible();
  await expect(page.getByText(/Evidence → Decision → Verification/)).toBeVisible();

  await page.getByRole("button", { name: "Review later", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Cursor Pro — review later" })).toBeVisible();
  await expect(page.getByText(/Nothing is cancelled/)).toBeVisible();

  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByText(/sample audit/i)).toHaveCount(0);
  await expect(page.getByText(/verified savings/i)).toHaveCount(0);
  await expect(page.getByText(/account aggregator|upi autopay|card e-mandate/i)).toHaveCount(0);

  const axe = await new AxeBuilder({ page }).analyze();
  const serious = axe.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  expect(serious).toEqual([]);
});

test("the mobile landing keeps the primary action visible without overflow", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");

  const heading = page.getByRole("heading", { level: 1, name: "See what your company is about to pay. Decide before the card fires." });
  const getStarted = page.locator("section").filter({ has: heading }).getByRole("link", { name: "Review one bill", exact: true });
  await expect(getStarted).toBeVisible();
  const actionBottom = await getStarted.evaluate((element) => element.getBoundingClientRect().bottom);
  const metrics = await page.evaluate(() => ({
    viewportHeight: window.innerHeight,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(metrics.documentWidth).toBeLessThanOrEqual(375 + 1);
  expect(actionBottom).toBeLessThan(metrics.viewportHeight);
});

test("login presents one Google identity path without product detours", async ({ page }) => {
  await page.goto("/login?next=/app");

  await expect(page.getByRole("heading", { level: 1, name: "Know what your company is committed to pay next" })).toBeVisible();
  await expect(page.getByText(/remember the bills you already reviewed/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByText("Google is only for sign-in. Vognary does not access Gmail.")).toBeVisible();

  await expect(page.getByRole("link", { name: "Continue privately" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Private audit" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "See product output" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save and sync with Google" })).toHaveCount(0);
});

test("signed-out app entry returns to the canonical sign-in path", async ({ page }) => {
  await page.goto("/app");

  await expect(page).toHaveURL(/\/login\?next=(?:%2F|\/)app$/);
  await expect(page.getByRole("heading", { level: 1, name: "Know what your company is committed to pay next" })).toBeVisible();
  await expect(page.getByLabel("Paste receipts or invoices")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "See a sample audit" })).toHaveCount(0);
});

test("a public query parameter cannot claim account deletion", async ({ page }) => {
  await page.goto("/?account=deleted");

  await expect(page.getByText(/account.*deleted/i)).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
