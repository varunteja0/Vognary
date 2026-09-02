import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { evidencePath } from "./evidence";

test("landing respects reduced motion", async ({ page }, testInfo) => {
  const surface = testInfo.project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your next expensive yes should leave a line behind it." })).toBeVisible();

  const motionState = await page.evaluate(() => ({
    rootScrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
    buttonTransition: getComputedStyle(document.querySelector<HTMLElement>(".btn")!).transitionDuration,
  }));
  expect(motionState.rootScrollBehavior).toBe("auto");
  expect(motionState.buttonTransition.split(",").every((duration) => durationToMs(duration) <= 0.001)).toBe(true);

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations.filter(({ impact }) => impact === "serious" || impact === "critical")).toEqual([]);
  await page.screenshot({ path: evidencePath(`wp-5.2-reduced-motion-${surface}.png`), fullPage: false, animations: "disabled" });
});

function durationToMs(duration: string) {
  const value = Number.parseFloat(duration);
  return duration.trim().endsWith("ms") ? value : value * 1_000;
}
