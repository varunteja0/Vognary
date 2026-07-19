import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/**
 * WP-2.2 — a signed-in user with an empty workspace can seed a clearly-labelled
 * sample audit in one click, explore the full product, and clear it in one click.
 * Runs against an empty workspace, so keep it isolated from the paste-based
 * signed-in-first-value spec (reset the DB before invoking).
 *
 *   PLAYWRIGHT_EXTERNAL_SERVER=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3005 \
 *   VOGNARY_E2E_DEV_LOGIN_EMAIL=founder@vognary.test \
 *   VOGNARY_E2E_DEV_LOGIN_CODE=local-dev-code-123 \
 *   npm run test:e2e -- sample-workspace
 */

const email = process.env.VOGNARY_E2E_DEV_LOGIN_EMAIL;
const accessCode = process.env.VOGNARY_E2E_DEV_LOGIN_CODE;

test.skip(!email || !accessCode, "development login env not configured");

test("empty workspace seeds and clears a labelled sample audit", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  mkdirSync("docs/evidence/surface-10", { recursive: true });
  const surface = testInfo.project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `vognary-e2e-sample-${testInfo.project.name}-${Date.now()}` });

  // Sign in directly to an empty workspace (no guest paste).
  await page.goto("/login");
  await page.getByText("Other ways to sign in").click();
  await page.getByPlaceholder("developer@example.com").fill(email!);
  await page.getByPlaceholder("Access code").fill(accessCode!);
  await page.getByRole("button", { name: "Sign in as developer" }).click();
  await page.waitForURL(/\/app/, { timeout: 30_000 });
  await page.waitForResponse(
    (response) => response.url().includes("/api/workspaces/current/audit-snapshot") && response.request().method() === "GET",
    { timeout: 30_000 },
  );
  await page.waitForTimeout(500);

  const banner = page.getByRole("status").filter({ hasText: /Sample data/ });
  // Self-heal: a prior project in this run (both share one founder workspace)
  // may have left a sample loaded. Normalize to an empty workspace first.
  if (await banner.isVisible({ timeout: 2_000 }).catch(() => false)) {
    const normalized = page.waitForResponse(isSnapshotSavePost, { timeout: 20_000 });
    await banner.getByRole("button", { name: "Clear sample" }).click();
    await expect(banner).toHaveCount(0);
    await normalized;
  }

  // The empty onboarding offers the sample, and no ledger exists yet.
  const seedButton = page.getByRole("button", { name: "See a sample audit" });
  await expect(seedButton).toBeVisible({ timeout: 30_000 });

  // Seed → eight subscriptions populate, the labelled banner appears, it persists.
  const savedSample = page.waitForResponse(isSnapshotSavePost, { timeout: 20_000 });
  await seedButton.click();
  await expect(banner).toBeVisible();
  await savedSample;

  // Home now shows the populated overview (not the empty state).
  const workspaceNav = page.locator('nav[aria-label="Workspace sections"]:visible');
  await workspaceNav.getByText("Home", { exact: true }).click();
  await expect(page.locator("#overview").getByText("Monthly burn", { exact: true }).first()).toBeVisible({ timeout: 15_000 });

  // The demo ledger is fully explorable — spot-check two of the eight.
  await workspaceNav.getByText("Subscriptions", { exact: true }).click();
  const ledger = page.locator("#recurring-ledger");
  await expect(ledger.getByText("Netflix", { exact: true }).first()).toBeVisible();
  await expect(ledger.getByText("Spotify", { exact: true }).first()).toBeVisible();
  await expectAxeClean(page, "Sample subscriptions");
  await page.screenshot({ path: `docs/evidence/surface-10/wp-2.2-sample-${surface}.png`, fullPage: false, animations: "disabled" });

  // Clear → Home returns to its empty state and the sample must not linger server-side.
  await workspaceNav.getByText("Home", { exact: true }).click();
  const clearedSample = page.waitForResponse(isSnapshotSavePost, { timeout: 20_000 });
  await banner.getByRole("button", { name: "Clear sample" }).click();
  await expect(banner).toHaveCount(0);
  await expect(page.locator("#overview").getByText("Your recurring money, answered in five seconds.")).toBeVisible();
  await clearedSample;
  // The seed remains reachable from the empty-workspace onboarding (Connect).
  await workspaceNav.getByText("Connect", { exact: true }).click();
  await expect(page.getByRole("button", { name: "See a sample audit" })).toBeVisible();
});

function isSnapshotSavePost(response: import("@playwright/test").Response) {
  return response.url().includes("/api/workspaces/current/audit-snapshot")
    && response.request().method() === "POST"
    && response.ok();
}

async function expectAxeClean(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).analyze();
  const serious = result.violations.filter(({ impact }) => impact === "serious" || impact === "critical");
  expect(serious, `${label}\n${serious.map((violation) => `${violation.id}: ${violation.help}`).join("\n")}`).toEqual([]);
}
