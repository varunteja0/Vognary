import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Recovery Customer #0: visible browser actions, real Recovery HTTP handlers,
 * real session cookies, and disposable PostgreSQL. The only test boundary is
 * the repository's email-bound development login; no Recovery API is mocked or
 * called through page.request.
 */

const email = process.env.VOGNARY_E2E_DEV_LOGIN_EMAIL;
const accessCode = process.env.VOGNARY_E2E_DEV_LOGIN_CODE;

const firstReceipt = [
  "OpenAI",
  "Invoice paid INR 1,999.00",
  "Payment date: 6 July 2026",
  "ChatGPT Plus renews monthly on 6 August 2026.",
].join("\n");

const secondReceipt = [
  "OpenAI",
  "Invoice paid INR 2,099.00",
  "Payment date: 6 August 2026",
  "ChatGPT Plus renews monthly on 6 September 2026.",
].join("\n");

const laterReceipt = [
  "OpenAI",
  "Invoice paid INR 2,299.00",
  "Payment date: 6 September 2026",
  "ChatGPT Plus renews monthly on 6 October 2026.",
].join("\n");

test.skip(!email || !accessCode, "database-backed development login env not configured");

test("Customer #0 completes the Recovery and fail-closed mandate journey in the browser", async ({ page, isMobile }, testInfo) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as typeof window & { __vognaryCopiedText?: string }).__vognaryCopiedText = text;
        },
      },
    });
  });
  const addressBlock = testInfo.project.name.includes("mobile") ? "203.0.113" : "198.51.100";
  await page.context().setExtraHTTPHeaders({
    "x-forwarded-for": `${addressBlock}.${Math.floor(Math.random() * 180) + 50}`,
  });
  const runtimeFailures = collectRuntimeFailures(page);
  await resetCustomerZeroThroughUi(page);

  // 1-3. Open landing and establish a saved identity independently of provider activation.
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Know what renews. Decide what stays.");
  await tabToAndActivate(page, "Sign in");
  await expect(page).toHaveURL(/\/login\?next=/);
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await loginAsDevelopmentUser(page);
  await expect(page.getByRole("heading", { level: 1, name: "Vognary" })).toBeVisible();

  // 4-7. Add bills from empty Home, not Gmail setup.
  await expect(page.getByRole("heading", { name: "Start with a software bill." })).toBeVisible();
  await page.getByRole("button", { name: "Add a bill" }).click();
  const addBills = page.getByRole("dialog", { name: "Add a bill" });
  await expect(addBills).toBeVisible();
  await addBills.getByRole("tab", { name: "Paste text" }).click();
  await addBills.getByLabel("Receipt or invoice text").fill(`${firstReceipt}\n\n${secondReceipt}`);
  await addBills.getByRole("button", { name: "Add a bill" }).click();
  await expect(page.getByRole("heading", { name: "Decide now" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Next charges" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "What we found" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Receipts checked" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Since your last visit" })).toHaveCount(0);
  await expect(page.getByText("Annualized estimate", { exact: true })).toHaveCount(0);
  await expect(page.getByText("OpenAI").first()).toBeVisible();
  await expectNoSeriousAxeViolations(page, "Recovery Home baseline");
  await expectNoHorizontalOverflow(page);
  if (isMobile) await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();

  await openCommitment(page, "OpenAI");
  await page.getByRole("tab", { name: "Why" }).click();
  const exactEvidenceTrigger = page.getByRole("button", { name: "See the receipt" }).first();
  await exactEvidenceTrigger.click();
  const evidenceDialog = page.getByRole("dialog", { name: "The receipt" });
  await expect(evidenceDialog).toBeVisible();
  await expect(evidenceDialog.getByText("Observed fact (exact excerpt)")).toBeVisible({ timeout: 15_000 });
  await expect(evidenceDialog).toContainText("OpenAI");
  await expectNoSeriousAxeViolations(page, "exact evidence dialog");
  await page.keyboard.press("Tab");
  await expect(evidenceDialog.locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(evidenceDialog).toHaveCount(0);
  await expect(exactEvidenceTrigger).toBeFocused();

  await openCommitment(page, "OpenAI");

  // Save one decision on the first recurring commitment.
  const reviewChoice = page.getByRole("button", { name: "Review later", exact: true });
  if (!(await reviewChoice.isVisible())) {
    await page.getByRole("button", { name: "Change", exact: true }).click();
  }
  await reviewChoice.click();
  await expect(page.getByText(/Saved Review later on/)).toBeVisible();
  await selectRecoveryView(page, "Now");
  // The decision is remembered for this cycle, so Home stops asking for it.
  await expect(page.getByRole("heading", { name: "You're caught up" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Decide now" })).toHaveCount(0);
  await openCommitment(page, "OpenAI");

  // 16-20. Correct every contract field through the modal UI.
  await page.getByText("Something wrong?").click();
  await saveCorrection(page, "Correct merchant", "Correct merchant", async (dialog) => {
    await dialog.getByLabel("Merchant as it should read").fill("OpenAI India");
  });
  await expect(page.getByRole("heading", { name: "OpenAI India" })).toBeVisible();

  await saveCorrection(page, "Correct amount", "Correct amount", async (dialog) => {
    await dialog.getByLabel(/Amount in INR/).fill("1750.00");
  });
  await expect(page.getByText("Amount set to ₹1,750.00")).toBeVisible();

  await saveCorrection(page, "Correct expected date", "Correct expected date", async (dialog) => {
    await dialog.getByLabel("Date you actually expect this").fill("2026-09-07");
  });
  await expect(page.getByText("Expected date set to 7 Sept 2026")).toBeVisible();

  await saveCorrection(page, "Correct how often", "Correct how often", async (dialog) => {
    await dialog.getByLabel("How often this actually repeats").selectOption("YEARLY");
  });
  await expect(page.getByText("Cadence set to Yearly")).toBeVisible();

  await saveCorrection(page, "Correct recurring or not", "Correct recurring or not", async (dialog) => {
    await dialog.getByLabel("No, this was a one-off").check();
  });
  await expect(page.getByText("Marked as not recurring")).toBeVisible();

  // 21. Reverse the amount correction so later evidence can produce a real comparison.
  const amountHistory = page.locator("li").filter({ hasText: "Amount" }).filter({ hasText: "₹1,750.00" });
  await amountHistory.getByRole("button", { name: "Reverse this correction" }).click();
  await expect(amountHistory.getByText("Reversed", { exact: true })).toBeVisible();

  // 22-26. Exercise every stored decision through three primary and two secondary user choices.
  await page.getByText("More", { exact: true }).click();
  for (const decision of ["Keep", "Review later", "Consider a cheaper plan", "Plan to cancel", "I don’t recognize this"]) {
    const button = page.getByRole("button", { name: decision, exact: true });
    if (!(await button.isVisible())) {
      const change = page.getByRole("button", { name: "Change", exact: true });
      if (await change.isVisible()) await change.click();
      const more = page.getByText("More", { exact: true });
      if (await more.isVisible()) await more.click();
    }
    await page.getByRole("button", { name: decision, exact: true }).click();
    await expect(page.getByText(new RegExp(`Saved ${escapeRegExp(decision)} on`))).toBeVisible();
  }
  await expectNoSeriousAxeViolations(page, "corrected commitment detail");

  // 27. Reload and verify the saved correction and final decision remain visible.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Vognary" })).toBeVisible();
  await openCommitment(page, "OpenAI India");
  await expect(page.getByText(/Saved I don’t recognize this on/)).toBeVisible();
  await page.getByText("Something wrong?").click();
  await expect(page.getByText("Merchant set to “OpenAI India”")).toBeVisible();

  // 28. Logout/relogin through visible controls and verify the same saved truth.
  await openAccount(page);
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByRole("heading", { level: 1, name: "Account settings" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await loginAsDevelopmentUser(page);
  await openCommitment(page, "OpenAI India");
  await expect(page.getByText(/Saved I don’t recognize this on/)).toBeVisible();

  // 29. Add later evidence and verify a real Changed event replaces the baseline.
  await openAddBills(page);
  await page.getByLabel("Receipt or invoice text").fill(laterReceipt);
  await page.getByRole("dialog", { name: "Add a bill" }).getByRole("button", { name: "Add a bill" }).click();
  await expect(page.getByRole("heading", { name: "What changed" })).toBeVisible();
  await expect(page.getByText("Amount changed").first()).toBeVisible();

  // 30. Unproven automation authority stays out of the public workspace.
  await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Automation" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "I accept this standing mandate" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Vognary" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  // The next charge is months away, so Home stays calm instead of manufacturing urgency.
  await expect(page.getByRole("heading", { name: "You're caught up" })).toBeVisible();

  // 31. Exercise canonical export and canonical deletion through Account settings.
  await openAccount(page);
  await expect(page).toHaveURL(/\/profile$/);
  await page.getByText("Privacy", { exact: true }).click();
  const exportButton = page.getByRole("button", { name: "Download my data" });
  await expect(exportButton).toBeEnabled();
  const [download] = await Promise.all([page.waitForEvent("download"), exportButton.click()]);
  expect(download.suggestedFilename()).toBe("vognary-privacy-export.json");
  await expect(page.getByText(/Privacy export downloaded/)).toBeVisible();
  await expectNoSeriousAxeViolations(page, "canonical profile export");

  await page.getByText("Danger Zone", { exact: true }).click();
  await page.getByLabel(/Type DELETE MY VOGNARY DATA to confirm/).fill("DELETE MY VOGNARY DATA");
  const deleteButton = page.getByRole("button", { name: "Delete server data" });
  await expect(deleteButton).toBeEnabled();
  await deleteButton.click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByRole("heading", { name: "Your Vognary account was deleted" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText(/Deleted 1 workspace\(s\) and signed out/);
  await expect(page.getByRole("status")).toContainText(/Provider-held copies and backups/);

  expect(runtimeFailures).toEqual([]);
});

async function resetCustomerZeroThroughUi(page: Page) {
  await page.context().clearCookies();
  await page.goto("/login?next=/app");
  await loginAsDevelopmentUser(page);
  await page.goto("/profile#delete-account");
  await page.getByText("Danger Zone", { exact: true }).click();
  const confirmation = page.getByLabel(/Type DELETE MY VOGNARY DATA to confirm/);
  await expect(confirmation).toBeVisible();
  await confirmation.fill("DELETE MY VOGNARY DATA");
  const deleteButton = page.getByRole("button", { name: "Delete server data" });
  await expect(deleteButton).toBeEnabled();
  await deleteButton.click();
  expect(new URL(page.url()).pathname).toBe("/profile");
  await expect(page.getByRole("heading", { name: "Your Vognary account was deleted" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText(/Deleted 1 workspace\(s\) and signed out/);
  await page.context().clearCookies();
}

async function openAccount(page: Page) {
  await page.evaluate(() => document.querySelector("nextjs-portal")?.remove());
  const account = page.getByRole("link", { name: new RegExp(`Account for ${email}`) });
  await account.focus();
  await account.press("Enter");
}

async function loginAsDevelopmentUser(page: Page) {
  if (!/\/login/.test(new URL(page.url()).pathname)) await page.goto("/login?next=/app");
  await page.getByText("Other ways to sign in").click();
  await page.getByLabel("Configured developer email").fill(email!);
  await page.getByLabel("Development access code").fill(accessCode!);
  await page.getByRole("button", { name: "Sign in as developer" }).click();
  await page.waitForURL(/\/app$/);
  await page.waitForLoadState("domcontentloaded");
  await expect(page.getByRole("heading", { level: 1, name: "Vognary" })).toBeVisible();
}

async function selectRecoveryView(page: Page, name: "Now" | "Bills" | "Receipts" | "Automation") {
  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name }).click();
}

async function openAddBills(page: Page) {
  const overlay = page.getByRole("dialog", { name: "Add a bill" });
  if (await overlay.isVisible()) {
    await overlay.getByRole("tab", { name: "Paste text" }).click();
    return;
  }
  const addBills = page.getByRole("button", { name: "Add a bill" });
  if (await addBills.first().isVisible()) {
    await addBills.first().click();
  } else {
    await selectRecoveryView(page, "Receipts");
    await page.getByRole("button", { name: "Add a bill" }).click();
  }
  await expect(overlay).toBeVisible();
  await overlay.getByRole("tab", { name: "Paste text" }).click();
}

async function openCommitment(page: Page, merchant: string) {
  await selectRecoveryView(page, "Bills");
  const heading = page.getByRole("heading", { name: merchant, exact: true });
  if (await heading.isVisible()) return;
  const commitment = page.getByRole("button", { name: new RegExp(merchant) }).first();
  await expect(commitment).toBeVisible({ timeout: 15_000 });
  await commitment.click();
  await expect(heading).toBeVisible({ timeout: 15_000 });
}

async function saveCorrection(
  page: Page,
  triggerName: string,
  dialogName: string,
  edit: (dialog: Locator) => Promise<void>,
) {
  const trigger = page.getByRole("button", { name: triggerName });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: dialogName });
  await expect(dialog).toBeVisible();
  await edit(dialog);
  await dialog.getByRole("button", { name: "Save correction" }).click();
  await expect(dialog).toHaveCount(0);
}

async function tabToAndActivate(page: Page, text: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await page.keyboard.press("Tab");
    const activeText = await page.evaluate(() => document.activeElement?.textContent?.replace(/\s+/g, " ").trim() ?? "");
    if (activeText === text) {
      await page.keyboard.press("Enter");
      return;
    }
  }
  throw new Error(`Keyboard could not reach ${text}.`);
}

async function expectNoSeriousAxeViolations(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).analyze();
  const serious = result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  expect(serious, `${label}:\n${serious.map((violation) => `${violation.id}: ${violation.help}`).join("\n")}`).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectRuntimeFailures(page: Page) {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(`page: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 500) failures.push(`response: ${response.status()} ${new URL(response.url()).pathname}`);
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (text.startsWith("Failed to load resource:")) return;
    if (text.includes("Content Security Policy directive")) return;
    failures.push(`console: ${text}`);
  });
  return failures;
}
