import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

test("demo workspace loads without runtime failures and passes serious accessibility checks", async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await page.goto("/app?demo=1");
  await expect(page.getByRole("heading", { level: 1, name: "Vognary recurring money workspace" })).toBeAttached();
  await expect(page.getByText("Sample data", { exact: true })).toBeVisible();
  await expect(page.locator("#overview").getByText("₹11,867", { exact: true }).first()).toBeVisible();
  await expectNoSeriousAxeViolations(page);
  expect(failures).toEqual([]);
});

test("mobile chapter navigation keeps the first screen focused and bounded", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/app?demo=1");
  const initial = await pageMetrics(page);
  expect(initial.visibleControls).toBeLessThanOrEqual(60);
  expect(initial.scrollHeight).toBeLessThanOrEqual(9_000);
  expect(initial.horizontalOverflow).toBe(false);

  await page.getByRole("link", { name: "Ledger", exact: true }).click();
  await expect(page.locator("#ledger")).toBeVisible();
  await expect(page.locator("#overview")).toBeHidden();
  await page.getByRole("link", { name: "Review", exact: true }).click();
  await expect(page.locator("#review")).toBeVisible();
  await expect(page.locator("#ledger")).toBeHidden();
});

test("clearing a workspace is confirmed and recoverable with undo", async ({ page }) => {
  await page.goto("/app?demo=1#connect");
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.getByRole("alertdialog", { name: "Clear this workspace?" })).toBeVisible();
  await page.getByRole("button", { name: "Clear workspace" }).click();
  await expect(page.getByText("Workspace cleared. This browser has no audit data now.")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Workspace restored.")).toBeVisible();
  await expect(page.getByText("Sample data", { exact: true })).toBeVisible();
});

test("guest first run reaches a useful sample ledger in one action", async ({ page }) => {
  await page.goto("/app?guest=1");
  await expect(page.getByText("Nothing connected yet")).toBeVisible();
  await page.getByRole("button", { name: "Load sample workspace" }).first().click();
  await expect(page.getByText("Sample data", { exact: true })).toBeVisible();
  if (test.info().project.name === "mobile-chromium") {
    await expect(page.locator("#ledger")).toBeVisible();
    await expect(page.locator("#recurring-ledger tbody tr")).toHaveCount(8);
  } else {
    await expect(page.locator("#overview").getByText("₹11,867", { exact: true }).first()).toBeVisible();
  }
});

test("monthly review controls are named and completion is visible", async ({ page }) => {
  await page.goto("/app?demo=1#review");
  await page.locator('a[href="#review"]').click();
  await expect(page.getByLabel("Reviewer name")).toBeVisible();
  await expect(page.getByLabel("Reviewer role")).toBeVisible();
  expect(await page.getByLabel(/^Owner for /).count()).toBeGreaterThan(0);
  expect(await page.getByLabel(/^Review note for /).count()).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Mark review complete" }).click();
  await expect(page.getByText(/Monthly review completed/)).toBeVisible();
  await expectNoSeriousAxeViolations(page);
});

test("a downloaded audit pack verifies locally without uploading report content", async ({ page }) => {
  await page.goto("/app?demo=1");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Sealed pack (JSON)" }).click();
  const download = await downloadPromise;
  const filePath = await download.path();
  expect(filePath).not.toBeNull();
  const pack = await readFile(filePath as string, "utf8");

  await page.goto("/verify");
  await page.getByLabel("Audit pack JSON").fill(pack);
  await page.getByRole("button", { name: "Verify pack" }).click();
  await expect(page.getByText("Self-checksum intact", { exact: true })).toBeVisible();
  await expect(page.getByText("Self-checksum only", { exact: true })).toBeVisible();
});

async function expectNoSeriousAxeViolations(page: Page) {
  await page.waitForTimeout(2_100);
  const result = await new AxeBuilder({ page }).analyze();
  const serious = result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  expect(serious, serious.map((violation) => `${violation.id}: ${violation.help}`).join("\n")).toEqual([]);
}

async function pageMetrics(page: Page) {
  return page.evaluate(() => {
    const visible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    return {
      visibleControls: [...document.querySelectorAll("button,a,input,textarea,select")].filter(visible).length,
      scrollHeight: document.documentElement.scrollHeight,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
}

function collectRuntimeFailures(page: Page) {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(`page: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  page.on("requestfailed", (request) => failures.push(`request: ${request.url()} ${request.failure()?.errorText ?? "failed"}`));
  return failures;
}