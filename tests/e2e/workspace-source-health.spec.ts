import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { evidencePath } from "./evidence";

const email = process.env.VOGNARY_E2E_DEV_LOGIN_EMAIL;
const accessCode = process.env.VOGNARY_E2E_DEV_LOGIN_CODE;

test.skip(!email || !accessCode, "development login env not configured");

test("workspace names stale sources and routes to their health chip", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const surface = testInfo.project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  let payload = connectorPayload("fresh");

  await page.setExtraHTTPHeaders({ "x-forwarded-for": `vognary-source-health-${surface}-${Date.now()}` });
  await page.route("**/api/workspaces/current/connectors", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });

  await page.goto("/login");
  await page.getByText("Other ways to sign in").click();
  await page.getByPlaceholder("developer@example.com").fill(email!);
  await page.getByPlaceholder("Access code").fill(accessCode!);
  const freshLoaded = page.waitForResponse(isConnectorStatusResponse, { timeout: 30_000 });
  await page.getByRole("button", { name: "Sign in as developer" }).click();
  await page.waitForURL(/\/app/, { timeout: 30_000 });
  await freshLoaded;

  const workspaceNav = page.locator('nav[aria-label="Workspace sections"]:visible');
  const panel = page.locator("section.dossier", { has: page.getByRole("heading", { name: "Connect evidence. Choose what to watch." }) });
  await workspaceNav.getByText("Connect", { exact: true }).click();
  await expect(panel.getByText("Fresh", { exact: true })).toBeVisible();

  payload = connectorPayload("stale");
  const staleLoaded = page.waitForResponse(isConnectorStatusResponse, { timeout: 30_000 });
  await page.reload();
  await staleLoaded;
  await workspaceNav.getByText("Home", { exact: true }).click();

  const home = page.locator("#overview");
  await expect(home.getByText(/Evidence source needs attention: Bank & UPI \(Account Aggregator\)/i)).toBeVisible();
  await home.getByRole("button", { name: "Review sources" }).click();
  await expect(panel.getByText("Needs refresh", { exact: true })).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations.filter(({ impact }) => impact === "serious" || impact === "critical")).toEqual([]);
  await positionForScreenshot(page, panel);
  await page.screenshot({ path: evidencePath(`wp-4.3-source-health-${surface}.png`), fullPage: false, animations: "disabled" });
});

function connectorPayload(freshnessStatus: "fresh" | "stale") {
  const account = {
    id: "11111111-1111-4111-8111-111111111111",
    connectorId: "account-aggregator",
    providerAccountId: "consent-e2e",
    displayName: "Bank & UPI (Account Aggregator)",
    scopes: ["aa:consent", "aa:fi-data:deposit"],
    status: "active",
    lastSyncedAt: "2026-07-17T12:00:00.000Z",
    nextSyncAt: "2026-07-18T12:00:00.000Z",
    coverageStartAt: "2026-01-01T00:00:00.000Z",
    coverageEndAt: "2026-07-17T12:00:00.000Z",
    coverageCompleteness: "complete",
    freshnessStatus,
    latestRunStatus: "succeeded",
    latestRunAt: "2026-07-17T12:00:00.000Z",
    evidenceCount: 6,
  };

  return {
    status: "ok",
    accounts: [account],
    sourceHealth: [{
      connectedAccountId: account.id,
      connectorId: account.connectorId,
      displayName: account.displayName,
      status: account.status,
      freshnessStatus,
      coverageStartAt: account.coverageStartAt,
      coverageEndAt: account.coverageEndAt,
      coverageCompleteness: account.coverageCompleteness,
      lastSyncedAt: account.lastSyncedAt,
      nextSyncAt: account.nextSyncAt,
      latestRunStatus: account.latestRunStatus,
    }],
    recurringItems: [],
    evidence: [],
  };
}

function isConnectorStatusResponse(response: import("@playwright/test").Response) {
  return response.url().includes("/api/workspaces/current/connectors")
    && response.request().method() === "GET"
    && response.ok();
}

async function positionForScreenshot(page: Page, target: import("@playwright/test").Locator) {
  await target.evaluate((element) => {
    const absoluteTop = element.getBoundingClientRect().top + window.scrollY;
    const stickyOffset = window.innerWidth < 700 ? 190 : 145;
    window.scrollTo({ top: Math.max(0, absoluteTop - stickyOffset), behavior: "instant" });
  });
  await page.waitForTimeout(250);
}
