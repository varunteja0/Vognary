import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const accountId = "11111111-1111-4111-8111-111111111111";

test("legacy source and launch URLs resolve to their task-oriented destinations", async ({ page }) => {
  await page.goto("/connect?from=legacy");
  await expect(page).toHaveURL(/\/sources\?from=legacy$/);

  await page.goto("/integrations");
  await expect(page).toHaveURL(/\/sources$/);

  await page.goto("/launch");
  await expect(page).toHaveURL(/\/private-audit$/);
});

test("source management keeps setup progressive and exposes honest retry and deletion flows", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 812 });
  await page.route("**/api/workspaces/current/connectors**", async (route) => {
    const request = route.request();
    if (request.method() === "POST" && request.url().endsWith(`/${accountId}/sync`)) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "synced", result: { evidenceWritten: 2 } }) });
      return;
    }
    if (request.method() === "DELETE" && request.url().endsWith(`/${accountId}`)) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "revoked", localCredentialsDeleted: true, providerRevocation: { status: "revoked", remoteCredentialMayRemainActive: false } }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ok",
        ledgerVersion: 1,
        accounts: [{
          id: accountId,
          connectorId: "gmail-readonly",
          displayName: "Gmail receipts",
          status: "active",
          lastSyncedAt: "2026-07-10T10:00:00.000Z",
          nextSyncAt: "2026-07-14T10:00:00.000Z",
          coverageStartAt: "2026-06-01T00:00:00.000Z",
          coverageEndAt: "2026-07-10T00:00:00.000Z",
          coverageCompleteness: "partial",
          freshnessStatus: "stale",
          latestRunStatus: "failed",
          evidenceCount: 4,
        }],
        sourceHealth: [],
        recurringItems: [{ id: "commitment-1" }],
        evidence: [{ id: "evidence-1" }],
      }),
    });
  });

  await page.goto("/sources");
  await expect(page.getByRole("heading", { name: "Keep the evidence behind your renewals current" })).toBeVisible();
  await expect(page.getByText("Available connections and setup status")).toHaveCount(0);
  await expect(page.getByText("Developer account sources")).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);

  await page.getByRole("button", { name: "Retry sync" }).click();
  await expect(page.getByText("Sync finished with 2 evidence signals written.")).toBeVisible();

  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByText("This deletes Vognary's encrypted local credentials")).toBeVisible();
  await page.getByRole("button", { name: "Disconnect and delete" }).click();
  await expect(page.getByText(/Local credentials were deleted, scheduled sync stopped/)).toBeVisible();

  await page.getByText("Add or reconnect a source").click();
  await expect(page.getByRole("button", { name: "Continue to Google" })).toBeVisible();
  await expect(page.getByText("Developer account sources")).toBeVisible();
});
