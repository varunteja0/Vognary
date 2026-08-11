import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

test("canonical product entry names unavailable forwarding without seeded data", async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Know what’s renewing before you pay for it." })).toBeVisible();
  await expect(page.getByText(/Receipt forwarding is not active in this deployment/i)).toBeVisible();
  await expect(page.getByText(/does not access your inbox/i)).toBeVisible();
  await expect(page.getByText(/sample audit/i)).toHaveCount(0);
  await expect(page.locator('a[href*="demo="], a[href*="guest="]')).toHaveCount(0);
  await expectNoSeriousAxeViolations(page);
  expect(failures).toEqual([]);
});

test("legacy mode URLs canonicalize to the saved-workspace sign-in without loading demo records", async ({ page }) => {
  for (const legacyUrl of ["/app?demo=1", "/app?guest=1"]) {
    await page.goto(legacyUrl);
    await expect(page).toHaveURL(/\/login\?next=(?:%2F|\/)app$/);
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    await expect(page.getByLabel("Paste receipts or invoices")).toHaveCount(0);
  }
});

test("mobile production entry keeps the forwarding action focused and bounded", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  const initial = await pageMetrics(page);
  expect(initial.visibleControls).toBeLessThanOrEqual(8);
  expect(initial.scrollHeight).toBeLessThanOrEqual(812 * 3);
  expect(initial.horizontalOverflow).toBe(false);
});

test("signed-out app entry cannot expose manual or sample financial data", async ({ page }) => {
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login\?next=(?:%2F|\/)app$/);
  await expect(page.getByLabel("Paste receipts or invoices")).toHaveCount(0);
  await expect(page.getByText(/sample audit/i)).toHaveCount(0);
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
      const isInsideClosedDetails = element.closest("details:not([open])") !== null;
      const isInsideViewport =
        rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
      return (
        !isInsideClosedDetails &&
        isInsideViewport &&
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden"
      );
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
  page.on("requestfailed", (request) => {
    const error = request.failure()?.errorText ?? "failed";
    const url = new URL(request.url());
    if (error === "net::ERR_ABORTED" && request.method() === "GET" && url.searchParams.has("_rsc")) return;
    failures.push(`request: ${request.url()} ${error}`);
  });
  return failures;
}
