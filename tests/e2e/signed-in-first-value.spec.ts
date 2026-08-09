import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { evidencePath } from "./evidence";
import { resetDevelopmentWorkspace } from "./workspace-reset";

/**
 * Signed-in first-value harness — the agent-facing proof that the core loop
 * works end-to-end: paste real-format receipts → burn/renewal/action appear,
 * survive sign-in, and merchant watches persist across reload.
 *
 * Requires a running server with the development login configured
 * (ENABLE_DEVELOPMENT_LOGIN, DEVELOPMENT_LOGIN_EMAIL, DEVELOPMENT_LOGIN_ACCESS_CODE
 * plus a database). Run:
 *   PLAYWRIGHT_EXTERNAL_SERVER=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3005 \
 *   VOGNARY_E2E_DEV_LOGIN_EMAIL=founder@vognary.test \
 *   VOGNARY_E2E_DEV_LOGIN_CODE=local-dev-code-123 \
 *   npm run test:e2e -- signed-in-first-value
 * Without the env vars the suite skips, so default CI is unaffected.
 */

const email = process.env.VOGNARY_E2E_DEV_LOGIN_EMAIL;
const accessCode = process.env.VOGNARY_E2E_DEV_LOGIN_CODE;

const realFormatReceipts = `Netflix
Your payment of ₹649.00 was successful.
Payment date: 17 June 2026
Next billing date: 17 July 2026

Spotify Premium
Receipt: ₹119.00 charged to your card
Date: 05 July 2026
Your subscription renews monthly.`;

test.skip(!email || !accessCode, "development login env not configured");

test("guest paste produces first value, survives sign-in, and watches persist", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const surface = testInfo.project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `vognary-e2e-${testInfo.project.name}-${Date.now()}` });
  await resetDevelopmentWorkspace(page, email!, accessCode!, `first-value-${surface}`);

  // 1. Guest paste with month-name dates (the format real receipts use).
  await page.goto("/app");
  const paste = page.locator("textarea").first();
  await paste.waitFor({ timeout: 30_000 });
  await paste.fill(realFormatReceipts);
  await expect(page.getByText("Monthly burn", { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Netflix/).first()).toBeVisible();

  // 2. Sign in through the development login.
  await page.goto("/login");
  await page.getByText("Other ways to sign in").click();
  await page.getByPlaceholder("developer@example.com").fill(email!);
  await page.getByPlaceholder("Access code").fill(accessCode!);
  await page.getByRole("button", { name: "Sign in as developer" }).click();
  const hydrated = page.waitForResponse(
    (response) => response.url().includes("/api/workspaces/current/audit-snapshot") && response.request().method() === "GET",
    { timeout: 30_000 },
  );
  await page.waitForURL(/\/app/, { timeout: 30_000 });
  await hydrated;
  await page.waitForTimeout(500);
  const transferNotice = page.getByRole("status").filter({
    hasText: /2 commitments carried into your encrypted workspace|Guest audit saved to this encrypted workspace/i,
  });
  if (await transferNotice.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await transferNotice.getByRole("button", { name: "Dismiss" }).click();
  }

  // 3. Home is the five-second answer and the workspace has only three
  //    primary destinations. Budgets must persist through encrypted sync.
  const workspaceNav = page.locator('nav[aria-label="Workspace sections"]:visible');
  for (const destination of ["Home", "Subscriptions", "Connect"]) {
    await expect(workspaceNav.getByText(destination, { exact: true })).toBeVisible();
  }
  await workspaceNav.getByText("Home", { exact: true }).click();
  const home = page.locator("#overview");
  for (const card of ["Monthly burn", "Renews next", "Due in 30 days", "Do this first"]) {
    await expect(home.getByText(card, { exact: true }).first()).toBeVisible();
  }
  const monthlyBurnCard = home.getByRole("button").filter({ hasText: "Monthly burn" });
  await expect(monthlyBurnCard.getByText(/No comparison yet|since last review/i)).toBeVisible();
  await expect(home.getByLabel(/Monthly budget/)).toBeVisible();
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.defineProperties(event, {
      prompt: { value: async () => undefined },
      userChoice: { value: Promise.resolve({ outcome: "dismissed", platform: "web" }) },
    });
    window.dispatchEvent(event);
  });
  const installPrompt = page.getByRole("region", { name: "Install Vognary" });
  await expect(installPrompt).toBeVisible();
  await installPrompt.getByRole("button", { name: "Not now" }).click();
  await expect(installPrompt).toHaveCount(0);
  const monthlyBudget = testInfo.project.name.startsWith("mobile") ? 201 : 200;
  const categoryBudget = testInfo.project.name.startsWith("mobile") ? 51 : 50;
  const savedBudgets = page.waitForResponse(
    (response) => isSnapshotSaveWithBudgets(response, monthlyBudget, "Streaming", categoryBudget),
    { timeout: 20_000 },
  );
  await home.getByLabel(/Monthly budget/).fill(String(monthlyBudget));
  await home.getByText("Category budgets", { exact: true }).click();
  await home.getByLabel("Streaming monthly budget").fill(String(categoryBudget));
  await savedBudgets;
  await expect(page.getByText(/over budget/i).first()).toBeVisible();
  await expect(home.getByText("Suggested cuts", { exact: true })).toBeVisible();

  // P0.1 — the signed-in workspace hands off the same cite-or-shut-up report the
  // guest surface produces, built with this workspace's own keep/cancel actions.
  await expect(home.getByRole("button", { name: "Copy report" })).toBeVisible();
  await expect(home.getByRole("button", { name: "Copy for WhatsApp" })).toBeVisible();

  // WP-6.3 — an aggregate ₹ figure (a sum with no single detail sheet) carries
  //   its own proof chip that reveals the exact evidence rows composing it.
  // The Renewal Radar also carries a "Due in 30 days" mini-stat; the OverviewPanel
  //   card is the one that also shows "Needs review", so pin it by both texts.
  const dueCard = home.locator(".inset").filter({ hasText: "Due in 30 days" }).filter({ hasText: "Needs review" });
  // Name toggles "Proof" -> "Hide proof" when open (visible text is the accessible
  //   name, satisfying Label-in-Name), so match case-insensitively.
  const proofChip = dueCard.getByRole("button", { name: /proof/i });
  await expect(proofChip).toHaveAttribute("aria-expanded", "false");
  await proofChip.click();
  await expect(proofChip).toHaveAttribute("aria-expanded", "true");
  const proofRegion = dueCard.getByRole("list");
  await expect(proofRegion).toBeVisible();
  await expect(proofRegion.getByText(/Netflix|Spotify|No projected debits/).first()).toBeVisible();
  await positionForScreenshot(page, dueCard);
  await page.screenshot({ path: evidencePath(`wp-6.3-proof-chip-${surface}.png`), fullPage: false, animations: "disabled" });
  await proofChip.click();
  await expect(proofChip).toHaveAttribute("aria-expanded", "false");

  // WP-6.1 — the Renewal Radar is Home's hero: proven upcoming debits as bars.
  const radar = page.locator('section[aria-labelledby="renewal-radar-heading"]');
  await expect(radar).toBeVisible();
  await expect(radar.getByRole("heading", { name: /proven debit/i })).toBeVisible();
  await expectAxeClean(page, "Home");
  await positionForScreenshot(page, home);
  await page.screenshot({ path: evidencePath(`wp-1.2-home-${surface}.png`), fullPage: false, animations: "disabled" });
  await positionForScreenshot(page, monthlyBurnCard);
  await page.screenshot({ path: evidencePath(`wp-1.2-home-trend-${surface}.png`), fullPage: false, animations: "disabled" });
  await positionForScreenshot(page, radar);
  await page.screenshot({ path: evidencePath(`wp-6.1-radar-${surface}.png`), fullPage: false, animations: "disabled" });

  // WP-1.3 + WP-6.1 — tapping a radar bar opens the detail sheet in place
  //   (proof + a decision control), records an action, and closes on Escape.
  await radar.getByRole("button", { name: /renews/i }).first().click();
  const detailSheet = page.getByRole("dialog").filter({ hasText: "Proof · where this came from" });
  await expect(detailSheet).toBeVisible();
  await expect(detailSheet.getByRole("group", { name: /Choose an action/ })).toBeVisible();
  await expectAxeClean(page, "Detail sheet");
  await positionForScreenshot(page, detailSheet);
  await page.screenshot({ path: evidencePath(`wp-1.3-detail-${surface}.png`), fullPage: false, animations: "disabled" });
  const monitorAction = detailSheet.getByRole("button", { name: "Monitor", exact: true });
  await monitorAction.click();
  await expect(monitorAction).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(detailSheet).toHaveCount(0);

  await workspaceNav.getByText("Subscriptions", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your subscriptions" })).toBeVisible();
  await expect(page.getByLabel("Sort subscriptions")).toBeVisible();
  await expect(page.getByText("Category over budget", { exact: true }).first()).toBeVisible();
  await expectAxeClean(page, "Subscriptions");
  await positionForScreenshot(page, page.locator("#recurring-ledger"));
  await page.screenshot({ path: evidencePath(`wp-1.3-subscriptions-${surface}.png`), fullPage: false, animations: "disabled" });

  await workspaceNav.getByText("Connect", { exact: true }).click();

  // 4. The optional-rails panel is click-only: no credential inputs anywhere.
  const panel = page.locator("section.dossier", { has: page.getByRole("heading", { name: "Connected sources and watches" }) });
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await expect(panel.locator('input[type="password"]')).toHaveCount(0);
  await expect(panel.getByPlaceholder(/key/i)).toHaveCount(0);
  await expectAxeClean(page, "Connect");
  await positionForScreenshot(page, panel);
  await page.screenshot({ path: evidencePath(`wp-1.1-connect-${surface}.png`), fullPage: false, animations: "disabled" });

  // 5. Watch a merchant; the watch must survive a reload once the debounced
  //    encrypted workspace sync flushes.
  const netflixTile = panel
    .locator("div")
    .filter({ has: page.getByText("Netflix", { exact: true }) })
    .filter({ has: page.getByRole("button", { name: /^(Watch|Stop watching)$/ }) })
    .last();
  const watchButton = netflixTile.getByRole("button", { name: "Watch", exact: true });
  if (await watchButton.isVisible().catch(() => false)) {
    const savedSnapshot = page.waitForResponse(
      (response) =>
        response.url().includes("/api/workspaces/current/audit-snapshot")
        && response.ok()
        && (response.request().postData() ?? "").includes("netflix"),
      { timeout: 20_000 },
    );
    await watchButton.click();
    await expect(netflixTile.getByRole("button", { name: "Stop watching" })).toBeVisible();
    await savedSnapshot;
  }
  await page.reload();
  await expect(panel.getByRole("button", { name: "Stop watching" }).first()).toBeVisible({ timeout: 30_000 });

  // 6. Deliberately hold the next hydration request open and edit another
  //    watch first. The early edit and the existing server watch must merge,
  //    persist, and survive a second reload.
  const earlyMerchant = testInfo.project.name.startsWith("mobile") ? "Amazon Prime" : "Spotify";
  const earlyMerchantId = testInfo.project.name.startsWith("mobile") ? "prime-video" : "spotify";
  const earlyPanel = page.locator("section.dossier", { has: page.getByRole("heading", { name: "Connected sources and watches" }) });
  const earlyTile = earlyPanel
    .locator("div")
    .filter({ has: page.getByText(earlyMerchant, { exact: true }) })
    .filter({ has: page.getByRole("button", { name: /^(Watch|Stop watching)$/ }) })
    .last();
  const existingStop = earlyTile.getByRole("button", { name: "Stop watching", exact: true });
  if (await existingStop.isVisible().catch(() => false)) {
    const savedRemoval = page.waitForResponse(
      (response) => isSnapshotSaveWithWatch(response, earlyMerchantId, false),
      { timeout: 20_000 },
    );
    await existingStop.click();
    await savedRemoval;
    await page.reload();
    await expect(earlyTile.getByRole("button", { name: "Watch", exact: true })).toBeVisible({ timeout: 30_000 });
  }

  let delayedHydration = false;
  await page.route("**/api/workspaces/current/audit-snapshot", async (route) => {
    if (route.request().method() !== "GET" || delayedHydration) return route.continue();
    delayedHydration = true;
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.fulfill({ response });
  });
  await page.reload();
  const savedEarlyWatch = page.waitForResponse(
    (response) => isSnapshotSaveWithWatch(response, earlyMerchantId, true),
    { timeout: 20_000 },
  );
  await earlyTile.getByRole("button", { name: "Watch", exact: true }).click();
  await expect(earlyTile.getByRole("button", { name: "Stop watching" })).toBeVisible();
  await expect.poll(() => delayedHydration).toBe(true);
  await page.waitForTimeout(1_700);
  await expect(earlyTile.getByRole("button", { name: "Stop watching" })).toBeVisible();
  await savedEarlyWatch;
  await page.unroute("**/api/workspaces/current/audit-snapshot");
  await page.reload();
  await expect(earlyPanel.locator("div").filter({ has: page.getByText("Netflix", { exact: true }) }).getByRole("button", { name: "Stop watching" }).first()).toBeVisible({ timeout: 30_000 });
  await expect(earlyPanel.locator("div").filter({ has: page.getByText(earlyMerchant, { exact: true }) }).getByRole("button", { name: "Stop watching" }).first()).toBeVisible({ timeout: 30_000 });

  await workspaceNav.getByText("Home", { exact: true }).click();
  await expect(home.getByLabel(/Monthly budget/)).toHaveValue(String(monthlyBudget));
  await workspaceNav.getByText("Subscriptions", { exact: true }).click();
  await expect(page.getByText("Category over budget", { exact: true }).first()).toBeVisible();
});

function isSnapshotSaveWithWatch(response: import("@playwright/test").Response, merchantId: string, expected: boolean) {
  if (!response.url().includes("/api/workspaces/current/audit-snapshot") || response.request().method() !== "POST" || !response.ok()) return false;
  try {
    const payload = response.request().postDataJSON() as { snapshot?: { merchantLinks?: unknown } };
    const links = Array.isArray(payload.snapshot?.merchantLinks) ? payload.snapshot.merchantLinks : [];
    return links.includes(merchantId) === expected;
  } catch {
    return false;
  }
}

function isSnapshotSaveWithBudgets(
  response: import("@playwright/test").Response,
  monthlyBudget: number,
  category: string,
  categoryBudget: number,
) {
  if (!response.url().includes("/api/workspaces/current/audit-snapshot") || response.request().method() !== "POST" || !response.ok()) return false;
  try {
    const payload = response.request().postDataJSON() as { snapshot?: { monthlyBudget?: unknown; categoryBudgets?: unknown } };
    const categories = payload.snapshot?.categoryBudgets;
    return payload.snapshot?.monthlyBudget === monthlyBudget
      && Boolean(categories && typeof categories === "object" && (categories as Record<string, unknown>)[category] === categoryBudget);
  } catch {
    return false;
  }
}

async function expectAxeClean(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).analyze();
  const serious = result.violations.filter(({ impact }) => impact === "serious" || impact === "critical");
  expect(serious, `${label}\n${serious.map((violation) => `${violation.id}: ${violation.help}`).join("\n")}`).toEqual([]);
}

async function positionForScreenshot(page: Page, target: import("@playwright/test").Locator) {
  await target.evaluate((element) => {
    const absoluteTop = element.getBoundingClientRect().top + window.scrollY;
    const stickyOffset = window.innerWidth < 700 ? 190 : 145;
    window.scrollTo({ top: Math.max(0, absoluteTop - stickyOffset), behavior: "instant" });
  });
  await page.waitForTimeout(250);
}
