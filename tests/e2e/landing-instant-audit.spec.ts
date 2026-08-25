import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { convert } from "html-to-text";

test("the public endpoints expose complete agent-readable contracts without JavaScript", async ({ request }) => {
  const htmlResponse = await request.get("/", { headers: { accept: "text/html" } });
  expect(htmlResponse.status()).toBe(200);
  expect(htmlResponse.headers()["content-type"]).toContain("text/html");
  expect(htmlResponse.headers().link).toContain('</index.md>; rel="alternate"; type="text/markdown"');
  expect(htmlResponse.headers().link).toContain('</llms.txt>; rel="describedby"');

  const html = await htmlResponse.text();
  const visibleText = convert(html, {
    selectors: [
      { selector: "script", format: "skip" },
      { selector: "style", format: "skip" },
    ],
  });
  expect(visibleText.length).toBeGreaterThanOrEqual(500);
  expect(html.match(/<h1\b/gi)?.length).toBe(1);
  expect(html.match(/<h2\b/gi)?.length ?? 0).toBeGreaterThanOrEqual(2);
  const headingLevels = [...html.matchAll(/<h([1-6])\b[^>]*>/gi)].map((match) => Number(match[1]));
  expect(headingLevels).toEqual([1, 2, 3, 4, 4, 2, 3]);
  expect(headingLevels.every((level, index) => index === 0 || level <= (headingLevels[index - 1] ?? level) + 1)).toBe(true);

  const jsonLdMatch = html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/);
  expect(jsonLdMatch).not.toBeNull();
  const jsonLd = JSON.parse(jsonLdMatch?.[1] ?? "{}") as {
    "@type"?: string;
    name?: string;
    url?: string;
    provider?: {
      "@type"?: string;
      contactPoint?: Array<{ contactType?: string; email?: string }>;
      address?: { "@type"?: string; addressCountry?: string };
    };
  };
  expect(jsonLd["@type"]).toBe("SoftwareApplication");
  expect(jsonLd.name).toBe("Vognary");
  expect(jsonLd.url).toBe("https://www.vognary.com/");
  expect(jsonLd.provider?.["@type"]).toBe("Organization");
  expect(jsonLd.provider?.contactPoint).toEqual(expect.arrayContaining([
    expect.objectContaining({ contactType: "customer support", email: "support@vognary.com" }),
  ]));
  expect(jsonLd.provider?.address).toEqual({ "@type": "PostalAddress", addressCountry: "IN" });

  const markdownResponse = await request.get("/", { headers: { accept: "text/markdown" } });
  expect(markdownResponse.status()).toBe(200);
  expect(markdownResponse.headers()["content-type"]).toBe("text/markdown; charset=utf-8");
  expect(markdownResponse.headers()["cache-control"]).toContain("no-store");
  expect(markdownResponse.headers().vary).toMatch(/(?:^|,\s*)Accept(?:,|$)/i);
  expect(await markdownResponse.text()).toContain("## Product boundaries");

  const unsupported = await request.get("/", { headers: { accept: "application/pdf" } });
  expect(unsupported.status()).toBe(406);
  expect(unsupported.headers()["content-type"]).toBe("text/plain; charset=utf-8");

  const explicitMarkdown = await request.get("/index.md");
  expect(explicitMarkdown.status()).toBe(200);
  expect(explicitMarkdown.headers()["content-type"]).toBe("text/markdown; charset=utf-8");

  const llms = await request.get("/llms.txt");
  expect(llms.status()).toBe(200);
  expect(llms.headers()["content-type"]).toBe("text/plain; charset=utf-8");
  expect(await llms.text()).toContain("**When to use Vognary**");

  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  expect(robots.headers()["content-type"]).toContain("text/plain");
  expect(await robots.text()).toContain("Sitemap: https://www.vognary.com/sitemap.xml");

  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  expect(sitemap.headers()["content-type"]).toContain("application/xml");
  expect(await sitemap.text()).toContain("<loc>https://www.vognary.com/</loc>");
  expect(await (await request.get("/sitemap.xml")).text()).toContain("<loc>https://www.vognary.com/about</loc>");

  const about = await request.get("/about");
  expect(about.status()).toBe(200);
  expect(about.headers()["content-type"]).toContain("text/html");
  const aboutHtml = await about.text();
  const aboutText = convert(aboutHtml, {
    selectors: [
      { selector: "script", format: "skip" },
      { selector: "style", format: "skip" },
    ],
  });
  expect(aboutText.length).toBeGreaterThanOrEqual(500);
  expect(aboutHtml.match(/<h1\b/gi)?.length).toBe(1);
  expect(aboutHtml.match(/<h2\b/gi)?.length ?? 0).toBeGreaterThanOrEqual(4);

  const security = await request.get("/.well-known/security.txt");
  expect(security.status()).toBe(200);
  expect(security.headers()["content-type"]).toContain("text/plain");

  const missing = await request.get("/this-agent-readiness-path-does-not-exist", {
    headers: { accept: "text/html" },
  });
  expect(missing.status()).toBe(404);
  const missingBody = await missing.text();
  expect(missingBody).toContain('href="/llms.txt"');
  expect(missingBody).toContain('href="/sitemap.xml"');

  const missingMarkdown = await request.get("/this-agent-readiness-path-does-not-exist", {
    headers: { accept: "text/markdown" },
  });
  expect(missingMarkdown.status()).toBe(404);
  expect(missingMarkdown.headers()["content-type"]).toBe("text/markdown; charset=utf-8");
  expect(missingMarkdown.headers()["cache-control"]).toContain("no-store");
  expect(await missingMarkdown.text()).toContain("[Public sitemap](https://www.vognary.com/sitemap.xml)");

  const missingCurlStyle = await request.get("/this-agent-readiness-path-does-not-exist", {
    headers: { accept: "*/*" },
  });
  expect(missingCurlStyle.status()).toBe(404);
  expect(missingCurlStyle.headers()["content-type"]).toBe("text/markdown; charset=utf-8");

});

test("the landing demonstrates the decision loop and sends visitors to their own bill", async ({ page }) => {
  await page.goto("/");

  const heading = page.getByRole("heading", { level: 1, name: "Know what renews. Decide what stays." });
  const hero = page.locator("section").filter({ has: heading });
  await expect(heading).toBeVisible();
  await expect(page.getByText(/Receipt forwarding is not active in this deployment/)).toHaveCount(0);

  const getStarted = hero.getByRole("link", { name: "Check a bill", exact: true });
  const signIn = page.getByRole("navigation", { name: "Public" }).getByRole("link", { name: "Sign in", exact: true });
  await expect(getStarted).toHaveAttribute("href", "/start");
  await expect(signIn).toHaveAttribute("href", "/login?next=/app");

  await expect(page.getByText("No account required", { exact: true })).toBeVisible();
  await expect(page.getByText("No bank passwords", { exact: true })).toBeVisible();
  await expect(page.getByText("No mailbox access", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cursor costs ₹350 more this month." })).toBeVisible();
  await expect(page.getByText("From two example receipts", { exact: true })).toBeVisible();
  await expect(page.getByText(/Example only\. Your review uses your receipts/)).toBeVisible();

  await page.getByRole("button", { name: "Review later", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Cursor Pro — review later" })).toBeVisible();
  await expect(page.getByText(/Nothing is cancelled/)).toBeVisible();

  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByText(/sample audit/i)).toHaveCount(0);
  await expect(page.getByText(/verified savings/i)).toHaveCount(0);
  await expect(page.getByText(/account aggregator|upi autopay|card e-mandate/i)).toHaveCount(0);

  const axe = await new AxeBuilder({ page }).analyze();
  const serious = axe.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  expect(serious).toEqual([]);
});

test("the mobile landing keeps the primary action visible without overflow", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");

  const heading = page.getByRole("heading", { level: 1, name: "Know what renews. Decide what stays." });
  const getStarted = page.locator("section").filter({ has: heading }).getByRole("link", { name: "Check a bill", exact: true });
  await expect(getStarted).toBeVisible();
  const actionBottom = await getStarted.evaluate((element) => element.getBoundingClientRect().bottom);
  const metrics = await page.evaluate(() => ({
    viewportHeight: window.innerHeight,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(metrics.documentWidth).toBeLessThanOrEqual(375 + 1);
  expect(actionBottom).toBeLessThan(metrics.viewportHeight);
});

test("login presents one Google identity path without product detours", async ({ page }) => {
  await page.goto("/login?next=/app");

  await expect(page.getByRole("heading", { level: 1, name: "Know what your company is committed to pay next" })).toBeVisible();
  await expect(page.getByText(/remember the bills you already reviewed/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByText("Google is only for sign-in. Vognary does not access Gmail.")).toBeVisible();

  await expect(page.getByRole("link", { name: "Continue privately" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Private audit" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "See product output" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save and sync with Google" })).toHaveCount(0);
});

test("signed-out app entry returns to the canonical sign-in path", async ({ page }) => {
  await page.goto("/app");

  await expect(page).toHaveURL(/\/login\?next=(?:%2F|\/)app$/);
  await expect(page.getByRole("heading", { level: 1, name: "Know what your company is committed to pay next" })).toBeVisible();
  await expect(page.getByLabel("Paste receipts or invoices")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "See a sample audit" })).toHaveCount(0);
});

test("a public query parameter cannot claim account deletion", async ({ page }) => {
  await page.goto("/?account=deleted");

  await expect(page.getByText(/account.*deleted/i)).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
