import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const receiptEvidence = [
  "OpenAI invoice paid INR 1,999 on 2026-07-06. ChatGPT Plus renews monthly.",
  "Notion invoice paid INR 830 on 2026-07-01. Notion Plus renews monthly.",
].join("\n\n");

test("canonical product entry opens a real private audit without seeded data", async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await page.goto("/app");
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { level: 1, name: "Know what renews before it charges" })).toBeVisible();
  await expect(page.getByLabel("Paste receipts or invoices")).toHaveValue("");
  await expect(page.getByRole("region", { name: "Your first audit result" })).toHaveCount(0);
  await expect(page.locator('a[href*="demo="], a[href*="guest="]')).toHaveCount(0);
  await expectNoSeriousAxeViolations(page);
  expect(failures).toEqual([]);
});

test("legacy mode URLs canonicalize to the production app without loading records", async ({ page }) => {
  for (const legacyUrl of ["/app?demo=1", "/app?guest=1"]) {
    await page.goto(legacyUrl);
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByLabel("Paste receipts or invoices")).toHaveValue("");
    await expect(page.getByRole("region", { name: "Your first audit result" })).toHaveCount(0);
  }
});

test("mobile production entry keeps the first screen focused and bounded", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/app");
  const initial = await pageMetrics(page);
  expect(initial.visibleControls).toBeLessThanOrEqual(10);
  expect(initial.scrollHeight).toBeLessThanOrEqual(812 * 2.5);
  expect(initial.horizontalOverflow).toBe(false);
});

test("real receipt evidence builds a proof-backed result and can be cleared", async ({ page }) => {
  await page.goto("/app");
  await page.getByLabel("Paste receipts or invoices").fill(receiptEvidence);
  const result = page.getByRole("region", { name: "Your first audit result" });
  await expect(result).toBeVisible();
  await expect(result.getByText("₹2,829")).toBeVisible();
  await expect(result.getByText("Proof", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear this tab" }).click();
  await expect(page.getByLabel("Paste receipts or invoices")).toHaveValue("");
  await expect(result).toHaveCount(0);
});

async function expectNoSeriousAxeViolations(page: Page) {
  await waitForEntranceAnimations(page);
  const result = await new AxeBuilder({ page }).analyze();
  const serious = result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  expect(serious, serious.map((violation) => `${violation.id}: ${violation.help}`).join("\n")).toEqual([]);
}

async function waitForEntranceAnimations(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const animations = [...document.querySelectorAll<HTMLElement>(".rise")]
      .flatMap((element) => element.getAnimations())
      .filter((animation) => animation.playState !== "finished");
    await Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)));
  });
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
