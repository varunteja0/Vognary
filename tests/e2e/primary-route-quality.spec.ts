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
  { label: "demo", path: "/demo", public: true },
  { label: "start", path: "/start", public: true },
  { label: "signed app", path: "/app", resolvedPath: /\/login\?next=(?:%2F|\/)app$/, public: false },
  { label: "login", path: "/login", public: true },
  { label: "profile", path: "/profile", resolvedPath: /\/login(?:\?.*)?$/, public: false },
  { label: "about", path: "/about", public: true },
  { label: "contact", path: "/contact", public: true },
  { label: "privacy", path: "/privacy", public: true },
  { label: "security", path: "/security", public: true },
  { label: "terms", path: "/terms", public: true },
  { label: "pay", path: "/pay", public: true },
  { label: "verify", path: "/verify", public: true },
  { label: "brand", path: "/brand", public: true },
  { label: "offline", path: "/offline", public: true },
  { label: "billing return", path: "/billing/return", public: true },
];

const publicRoutes = primaryRoutes.filter((route) => route.public);
const viewportWidths = [320, 360, 390, 768, 1024, 1440] as const;

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

test("public primary routes reflow at a 1440x900 desktop's 200% zoom equivalent", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 720, height: 450 });

  for (const route of publicRoutes) {
    await page.goto(route.path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const metrics = await horizontalMetrics(page);
    expect.soft(metrics.scrollWidth, `${route.label} overflows at the 200% zoom equivalent`).toBeLessThanOrEqual(721);
  }
});

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
  // /demo carries the one signature transition in the product — the cap line
  // resolving under the request — so the probe measures the real thing.
  await page.goto("/demo");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Approve with a lower cap" }).click();

  const motion = await page.evaluate(() => {
    const button = document.querySelector<HTMLElement>(".btn");
    const capRule = document.querySelector<HTMLElement>(".demo-cap-rule");
    if (!button) throw new Error("Reduced-motion button probe is missing");
    if (!capRule) throw new Error("Reduced-motion cap-rule probe is missing");
    const buttonStyle = getComputedStyle(button);
    const ruleStyle = getComputedStyle(capRule);
    return {
      matches: matchMedia("(prefers-reduced-motion: reduce)").matches,
      scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
      transitionDurations: buttonStyle.transitionDuration.split(",").map((value) => value.trim()),
      capAnimationName: ruleStyle.animationName,
      // Meaning is not hidden: the frozen cap is fully drawn, it simply does not
      // draw itself in. Base CSS is the resolved state, so there is nothing to
      // wait for and nothing at zero width.
      capTransform: ruleStyle.transform,
      capWidth: capRule.getBoundingClientRect().width,
    };
  });

  expect(motion.matches).toBe(true);
  expect(motion.scrollBehavior).toBe("auto");
  expect(motion.transitionDurations.every((duration) => durationInMilliseconds(duration) <= 0.01)).toBe(true);
  expect(motion.capAnimationName).toBe("none");
  expect(["none", "matrix(1, 0, 0, 1, 0, 0)"]).toContain(motion.capTransform);
  expect(motion.capWidth).toBeGreaterThan(0);
});

test("brand previews render the exact downloadable raster exports", async ({ page }) => {
  await page.goto("/brand");

  await expect(page.getByAltText("Vognary X profile header")).toHaveAttribute("src", "/brand/vognary-x-header.png");
  await expect(page.getByAltText("Vognary social link card")).toHaveAttribute("src", "/brand/vognary-social-card.png");
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
