import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { evidencePath } from "./evidence";

const email = process.env.VOGNARY_E2E_DEV_LOGIN_EMAIL;
const accessCode = process.env.VOGNARY_E2E_DEV_LOGIN_CODE;
const accountId = "11111111-1111-4111-8111-111111111111";
const sourceName = `account-aggregator-automatic-evidence-${accountId}.csv`;
const identityKey = "netflix::INR::1bnnxo7";

test.skip(!email || !accessCode, "development login env not configured");
test.skip(true, "Deferred legacy verified-savings surface is unreachable from Recovery v1 launch.");

test("verified savings share includes the card and sealed receipt", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const surface = testInfo.project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

  await page.addInitScript(() => {
    const shared: Array<{ title?: string; text?: string; files: Array<{ name: string; type: string; size: number }> }> = [];
    Object.defineProperty(window, "__vognaryShares", { value: shared, configurable: true });
    Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
    Object.defineProperty(navigator, "share", {
      value: async (data: ShareData) => {
        shared.push({
          title: data.title,
          text: data.text,
          files: (data.files ?? []).map((file) => ({ name: file.name, type: file.type, size: file.size })),
        });
      },
      configurable: true,
    });
  });
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `vognary-savings-share-${surface}-${Date.now()}` });
  await page.route("**/api/workspaces/current/audit-snapshot", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snapshotPayload()) });
      return;
    }
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ status: "saved", snapshot: { revision: 2 } }) });
  });
  await page.route("**/api/workspaces/current/connectors", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(connectorPayload()) });
  });
  await page.route("**/api/audit-packs/sign", async (route) => {
    await route.fulfill({ status: 501, contentType: "application/json", body: JSON.stringify({ status: "not-configured" }) });
  });

  await page.goto("/login");
  await page.getByText("Other ways to sign in").click();
  await page.getByPlaceholder("developer@example.com").fill(email!);
  await page.getByPlaceholder("Access code").fill(accessCode!);
  const hydrated = page.waitForResponse(
    (response) => response.url().includes("/api/workspaces/current/audit-snapshot") && response.request().method() === "GET",
    { timeout: 30_000 },
  );
  await page.getByRole("button", { name: "Sign in as developer" }).click();
  await page.waitForURL(/\/app/, { timeout: 30_000 });
  await hydrated;
  await page.goto("/app#review");

  const savingsPanel = page.locator("section.panel", { has: page.getByRole("heading", { name: "Verified savings" }) });
  await expect(savingsPanel.getByText(/₹7,788\/yr verified/i)).toBeVisible({ timeout: 20_000 });
  const nakulMoment = page.getByRole("status", { name: "Nakul moment" });
  await expect(nakulMoment.getByRole("heading", { name: "A saving is now proven" })).toBeVisible();
  await expect(nakulMoment.getByText("Verified outcome", { exact: true })).toBeVisible();
  await nakulMoment.screenshot({ path: evidencePath(`wp-6.4-nakul-moment-${surface}.png`), animations: "disabled" });
  await nakulMoment.getByRole("button", { name: "Dismiss" }).click();
  await expect(nakulMoment).toHaveCount(0);
  await page.reload();
  await expect(savingsPanel.getByText(/₹7,788\/yr verified/i)).toBeVisible({ timeout: 20_000 });
  await expect(nakulMoment).toHaveCount(0);
  await expect(savingsPanel.getByRole("button", { name: "Share proof" })).toBeVisible();
  await savingsPanel.getByRole("button", { name: "Share proof" }).click();

  await expect.poll(() => page.evaluate(() => (window as typeof window & { __vognaryShares: unknown[] }).__vognaryShares.length)).toBe(1);
  const shares = await page.evaluate(() => (window as typeof window & {
    __vognaryShares: Array<{ title?: string; text?: string; files: Array<{ name: string; type: string; size: number }> }>;
  }).__vognaryShares);
  expect(shares).toHaveLength(1);
  expect(shares[0].title).toBe("Vognary verified savings");
  expect(shares[0].text).toMatch(/7,788/);
  expect(shares[0].files.map(({ name }) => name)).toEqual(expect.arrayContaining([
    expect.stringMatching(/^vognary-savings-card\.(png|svg)$/),
    expect.stringMatching(/^vognary-savings-receipt-\d+\.json$/),
  ]));
  expect(shares[0].files.every(({ size }) => size > 0)).toBe(true);
  await expect(page.getByText(/Savings proof shared with the card and self-checksummed receipt/i)).toBeVisible();
  await page.getByRole("button", { name: "Dismiss" }).click();

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations.filter(({ impact }) => impact === "serious" || impact === "critical")).toEqual([]);
  await positionForScreenshot(page, savingsPanel);
  await page.screenshot({ path: evidencePath(`wp-6.2-savings-share-${surface}.png`), fullPage: false, animations: "disabled" });
});

function snapshotPayload() {
  return {
    status: "ok",
    snapshot: {
      id: "33333333-3333-4333-8333-333333333333",
      title: "Verified savings fixture",
      summary: {},
      revision: 1,
      createdAt: "2026-07-18T00:00:00.000Z",
      updatedAt: "2026-07-18T00:00:00.000Z",
      snapshot: {
        version: 1,
        exportedAt: "2026-07-18T00:00:00.000Z",
        statementSources: [{
          id: "source-verified-savings",
          name: sourceName,
          text: [
            "Date,Description,Debit,Credit",
            "2026-01-05,NETFLIX PREMIUM,649,",
            "2026-02-05,NETFLIX PREMIUM,649,",
            "2026-03-05,NETFLIX PREMIUM,649,",
          ].join("\n"),
          rowCount: 3,
          kind: "csv",
        }],
        manualItems: [],
        userActions: { [identityKey]: "cancel" },
        actionsMeta: { [identityKey]: { action: "cancel", decidedAt: "2026-03-20T00:00:00.000Z" } },
        itemOwners: {},
        reviewNotes: {},
        teamMembers: [{ id: "founder", name: "Founder", role: "Owner" }],
        receiptText: "",
        mergeDecisions: {},
        lastReview: null,
        reviewCompletedAt: null,
        merchantLinks: [],
        monthlyBudget: null,
        categoryBudgets: {},
      },
    },
  };
}

function connectorPayload() {
  return {
    status: "ok",
    accounts: [],
    sourceHealth: [{
      connectedAccountId: accountId,
      connectorId: "account-aggregator",
      displayName: "Bank & UPI (Account Aggregator)",
      status: "active",
      freshnessStatus: "fresh",
      coverageStartAt: "2026-01-01T00:00:00.000Z",
      coverageEndAt: "2026-07-17T23:59:59.000Z",
      coverageCompleteness: "complete",
      lastSyncedAt: "2026-07-17T23:59:59.000Z",
      nextSyncAt: "2026-07-18T23:59:59.000Z",
      latestRunStatus: "succeeded",
    }],
    recurringItems: [],
    evidence: [],
  };
}

async function positionForScreenshot(page: Page, target: import("@playwright/test").Locator) {
  await target.evaluate((element) => {
    const absoluteTop = element.getBoundingClientRect().top + window.scrollY;
    const stickyOffset = window.innerWidth < 700 ? 190 : 145;
    window.scrollTo({ top: Math.max(0, absoluteTop - stickyOffset), behavior: "instant" });
  });
  await page.waitForTimeout(250);
}
