import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

type PrimaryRoute = {
  label: string;
  path: string;
  resolvedPath?: RegExp;
  public: boolean;
};

const primaryRoutes: PrimaryRoute[] = [
  { label: "landing", path: "/", public: true },
  { label: "guest audit", path: "/app?guest=1", public: true },
  { label: "private audit", path: "/private-audit", public: true },
  { label: "login", path: "/login", public: true },
  { label: "sources", path: "/sources", public: true },
  { label: "profile", path: "/profile", resolvedPath: /\/login(?:\?.*)?$/, public: false },
  { label: "privacy", path: "/privacy", public: true },
  { label: "security", path: "/security", public: true },
  { label: "terms", path: "/terms", public: true },
];

const publicRoutes = primaryRoutes.filter((route) => route.public);
const viewportWidths = [320, 375, 768, 1440] as const;

test("primary routes expose a unique title, one h1, and a working global skip link", async ({ page }) => {
  test.setTimeout(90_000);
  const seenTitles = new Map<string, string>();

  for (const route of primaryRoutes) {
    await page.goto(route.path);
    if (route.resolvedPath) await expect(page).toHaveURL(route.resolvedPath);

    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1, `${route.label} should have exactly one h1`).toHaveCount(1);
    await expect(h1, `${route.label} h1 should be visible`).toBeVisible();
    expect((await h1.textContent())?.trim(), `${route.label} h1 should be descriptive`).toBeTruthy();

    const title = (await page.title()).trim();
    expect(title, `${route.label} should have a descriptive title`).not.toBe("");
    if (!route.resolvedPath) {
      expect(seenTitles.get(title), `${route.label} and ${seenTitles.get(title)} should not share ${JSON.stringify(title)}`).toBeUndefined();
      seenTitles.set(title, route.label);
    }

    const skipLink = page.getByRole("link", { name: "Skip to main content" });
    const mainTarget = page.locator("#main-content");
    await expect(skipLink).toHaveAttribute("href", "#main-content");
    await expect(mainTarget, `${route.label} should render the global skip target`).toHaveCount(1);
    await page.keyboard.press("Tab");
    await expect(skipLink, `${route.label} skip link should be the first keyboard stop`).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(mainTarget, `${route.label} skip link should move focus to main content`).toBeFocused();
  }
});

for (const width of viewportWidths) {
  test(`public primary routes do not overflow horizontally at ${width}px`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });

    for (const route of publicRoutes) {
      await page.goto(route.path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const metrics = await horizontalMetrics(page);
      expect.soft(
        metrics.scrollWidth,
        `${route.label} document width ${metrics.scrollWidth}px exceeds the ${width}px viewport${metrics.overflowing.length ? `; outside viewport: ${metrics.overflowing.join(", ")}` : ""}`,
      ).toBeLessThanOrEqual(width + 1);
    }
  });
}

test("public primary routes have no serious or critical axe violations", async ({ page }) => {
  test.setTimeout(120_000);

  for (const route of publicRoutes) {
    await page.goto(route.path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await waitForEntranceAnimations(page);
    const result = await new AxeBuilder({ page }).analyze();
    const serious = result.violations.filter(({ impact }) => impact === "serious" || impact === "critical");
    expect.soft(
      serious,
      `${route.label}\n${serious.map((violation) => `${violation.id}: ${violation.help}`).join("\n")}`,
    ).toEqual([]);
  }
});

test("reduced-motion preference suppresses decorative motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const motion = await page.evaluate(() => {
    const scan = document.querySelector<HTMLElement>(".scan");
    const liveDot = document.querySelector<HTMLElement>(".live-dot");
    const button = document.querySelector<HTMLElement>(".btn");
    if (!scan || !liveDot || !button) throw new Error("Reduced-motion probes are missing");
    const scanStyle = getComputedStyle(scan, "::after");
    const dotStyle = getComputedStyle(liveDot);
    const buttonStyle = getComputedStyle(button);
    return {
      matches: matchMedia("(prefers-reduced-motion: reduce)").matches,
      scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
      animationDurations: [scanStyle.animationDuration, dotStyle.animationDuration],
      animationIterations: [scanStyle.animationIterationCount, dotStyle.animationIterationCount],
      transitionDurations: buttonStyle.transitionDuration.split(",").map((value) => value.trim()),
    };
  });

  expect(motion.matches).toBe(true);
  expect(motion.scrollBehavior).toBe("auto");
  expect(motion.animationDurations.every((duration) => durationInMilliseconds(duration) <= 0.01)).toBe(true);
  expect(motion.animationIterations).toEqual(["1", "1"]);
  expect(motion.transitionDurations.every((duration) => durationInMilliseconds(duration) <= 0.01)).toBe(true);
});

async function horizontalMetrics(page: Page) {
  return page.evaluate(() => {
    const overflowing = [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.right > window.innerWidth + 1 || rect.left < -1;
      })
      .slice(0, 6)
      .map((element) => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${element.classList.length ? `.${[...element.classList].slice(0, 2).join(".")}` : ""}`);
    return {
      scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      overflowing,
    };
  });
}

function durationInMilliseconds(duration: string) {
  const value = Number.parseFloat(duration);
  return duration.endsWith("ms") ? value : value * 1_000;
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
