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
  expect(visibleText).toMatch(/Commitment Control/i);

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
  expect(markdownResponse.headers()["content-type"]).toContain("text/html");
  expect(markdownResponse.headers().vary ?? "").not.toMatch(/(?:^|,\s*)Accept(?:,|$)/i);
  expect(markdownResponse.headers().link).toContain('</index.md>; rel="alternate"; type="text/markdown"');

  const unsupported = await request.get("/", { headers: { accept: "application/pdf" } });
  expect(unsupported.status()).toBe(200);
  expect(unsupported.headers()["content-type"]).toContain("text/html");

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
  expect(await (await request.get("/sitemap.xml")).text()).toContain("<loc>https://www.vognary.com/pay</loc>");

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

test("the server-rendered landing has no skipped heading levels", async ({ request }) => {
  const response = await request.get("/", { headers: { accept: "text/html" } });
  expect(response.status()).toBe(200);
  const html = await response.text();
  const headingLevels = [...html.matchAll(/<h([1-6])\b[^>]*>/gi)].map((match) => Number(match[1]));
  expect(headingLevels.every((level, index) => index === 0 || level <= (headingLevels[index - 1] ?? level) + 1)).toBe(true);
});

test("the landing demonstrates the decision loop and sends visitors to their own bill", async ({ page }) => {
  await page.goto("/");

  const heading = page.getByRole("heading", {
    level: 1,
    name: "Vognary",
  });
  await expect(heading).toBeVisible();
  await expect(page.getByText(/Receipt forwarding is not active in this deployment/)).toHaveCount(0);

  // One primary command, one quiet secondary, one pilot action. Nothing else.
  await expect(page.getByRole("link", { name: "Review the synthetic request" }).first())
    .toHaveAttribute("href", "/demo");
  await expect(page.getByRole("link", { name: "Use your own evidence" }).first())
    .toHaveAttribute("href", "/start");
  await expect(page.getByRole("link", { name: "See the one-month pilot" })).toHaveAttribute("href", "/pay");

  // The product carries the promise: the live record, its cited history, the
  // policy result and the named human are all on the page as real DOM.
  await expect(page.getByText("INR 4,80,000").first()).toBeVisible();
  await expect(page.getByText("INR 3,20,000").first()).toBeVisible();
  await expect(page.getByText(/outside policy/i).first()).toBeVisible();
  await expect(page.getByText("INR 3,60,000").first()).toBeVisible();
  await expect(page.getByText("INR 4,72,000").first()).toBeVisible();
  await expect(page.getByTestId("synthetic-demonstration-label").first()).toBeVisible();

  // The desk shows the shape of the job, and the pilot states its own terms.
  await expect(page.getByRole("heading", { name: "A place for what needs you." })).toBeVisible();
  await expect(page.getByText(/Six synthetic records/)).toBeVisible();
  await expect(page.getByText("Needs a decision").first()).toBeVisible();
  await expect(page.getByText(/Payment is not activation/)).toBeVisible();
  await expect(page.getByText("INR 14,999").first()).toBeVisible();

  // The desk must never read as customer activity. Six synthetic records cannot
  // be described as a week of observed work, as states records "arrive" in, or
  // as anything a customer has done, because no customer has used Vognary.
  await expect(page.getByText(/Not customer activity\./).first()).toBeVisible();
  await expect(page.getByText(/not observed from any customer/i).first()).toBeVisible();
  await expect(page.getByText(/this is a week|states they actually arrive|demonstration loop/i)).toHaveCount(0);
  await expect(page.getByText(/customers (?:use|have used|are using)|teams (?:use|trust)|companies use/i)).toHaveCount(0);
  await expect(page.getByText(/last (?:week|month)|so far this|per week|this week alone/i)).toHaveCount(0);

  // Nothing invented, nothing retired.
  await expect(page.getByLabel("Paste receipts or invoices")).toHaveCount(0);
  await expect(page.getByText(/sample audit/i)).toHaveCount(0);
  await expect(page.getByText(/verified savings/i)).toHaveCount(0);
  await expect(page.getByText(/account aggregator|upi autopay|card e-mandate/i)).toHaveCount(0);

  const axe = await new AxeBuilder({ page }).analyze();
  const serious = axe.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  expect(serious, serious.map((violation) => `${violation.id}: ${violation.help}`).join("\n")).toEqual([]);
});

test("the mobile landing keeps the primary action visible without overflow", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");

  const primary = page.getByRole("link", { name: "Review the synthetic request" }).first();
  await expect(primary).toBeVisible();
  const actionBottom = await primary.evaluate((element) => element.getBoundingClientRect().bottom);
  const metrics = await page.evaluate(() => ({
    viewportHeight: window.innerHeight,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(metrics.documentWidth).toBeLessThanOrEqual(375 + 1);
  expect(actionBottom).toBeLessThan(metrics.viewportHeight);
});

test("login presents one Google identity path without product detours", async ({ page }) => {
  await page.goto("/login?next=/app");

  await expect(page.getByRole("heading", { level: 1, name: "Sign in to Vognary." })).toBeVisible();
  await expect(page.getByText("Commitments, decisions, and their evidence.")).toBeVisible();
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
  await expect(page.getByRole("heading", { level: 1, name: "Sign in to Vognary." })).toBeVisible();
  await expect(page.getByLabel("Paste receipts or invoices")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "See a sample audit" })).toHaveCount(0);
});

test("a public query parameter cannot claim account deletion", async ({ page }) => {
  await page.goto("/?account=deleted");

  await expect(page.getByText(/account.*deleted/i)).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
