import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("sample audit respects reduced motion", async ({ page }, testInfo) => {
  mkdirSync("docs/evidence/surface-10", { recursive: true });
  const surface = testInfo.project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    const calls: ScrollIntoViewOptions[] = [];
    Object.defineProperty(window, "__vognaryScrollCalls", { value: calls, configurable: true });
    Element.prototype.scrollIntoView = function scrollIntoView(options?: boolean | ScrollIntoViewOptions) {
      calls.push(typeof options === "object" ? options : {});
    };
  });

  await page.goto("/app");
  await page.getByRole("button", { name: "See a sample audit" }).click();
  const result = page.getByRole("region", { name: "Your first audit result" });
  await expect(result).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __vognaryScrollCalls: ScrollIntoViewOptions[] }).__vognaryScrollCalls.length)).toBeGreaterThan(0);

  const motionState = await page.evaluate(() => ({
    rootScrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
    calls: (window as typeof window & { __vognaryScrollCalls: ScrollIntoViewOptions[] }).__vognaryScrollCalls,
  }));
  expect(motionState.rootScrollBehavior).toBe("auto");
  expect(motionState.calls.at(-1)?.behavior).toBe("auto");

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations.filter(({ impact }) => impact === "serious" || impact === "critical")).toEqual([]);
  await page.screenshot({ path: `docs/evidence/surface-10/wp-5.2-reduced-motion-${surface}.png`, fullPage: false, animations: "disabled" });
});