import { expect, test, type Page } from "@playwright/test";

/**
 * "No button is a demo" — the behavioural half of the wiring guarantee.
 *
 * The static half (tests/control-wiring-guard.test.ts) proves the source has no
 * cosmetic controls. This spec proves the *live* controls actually complete a
 * real round-trip — and, crucially, that a gated provider degrades to an honest
 * notice instead of failing silently. Both paths are driven deterministically
 * with page.route, so the spec needs no real Google/Setu credentials.
 *
 * Guarded exactly like the sibling signed-in specs: it skips unless the dev
 * login env is present, so default CI is unaffected. Run on a quiescent tree:
 *   PLAYWRIGHT_EXTERNAL_SERVER=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3005 \
 *   VOGNARY_E2E_DEV_LOGIN_EMAIL=founder@vognary.test \
 *   VOGNARY_E2E_DEV_LOGIN_CODE=local-dev-code-123 \
 *   npm run test:e2e -- control-wiring-inventory
 */

const email = process.env.VOGNARY_E2E_DEV_LOGIN_EMAIL;
const accessCode = process.env.VOGNARY_E2E_DEV_LOGIN_CODE;

test.skip(!email || !accessCode, "development login env not configured");

async function signIn(page: Page, project: string) {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `vognary-wiring-${project}-${Date.now()}` });
  await page.goto("/login");
  await page.getByText("Other ways to sign in").click();
  await page.getByPlaceholder("developer@example.com").fill(email!);
  await page.getByPlaceholder("Access code").fill(accessCode!);
  await page.getByRole("button", { name: "Sign in as developer" }).click();
  await page.waitForURL(/\/app/, { timeout: 30_000 });
  await page.waitForResponse(
    (response) => response.url().includes("/api/workspaces/current/audit-snapshot") && response.request().method() === "GET",
    { timeout: 30_000 },
  );
  await page.waitForTimeout(400);
}

// Codex's progressive onboarding hides the rail cards behind a three-choice
// panel until the workspace has evidence. Seed the labelled sample so the real
// Connect rails render, then hand back the rail panel. Self-heals whether or not
// a prior test in the shared founder workspace already seeded.
async function openConnect(page: Page) {
  const nav = page.locator('nav[aria-label="Workspace sections"]:visible');
  await nav.getByText("Connect", { exact: true }).click();

  const panel = page.locator("section.dossier", {
    has: page.getByRole("heading", { name: "Connect evidence. Choose what to watch." }),
  });
  if (!(await panel.isVisible({ timeout: 5_000 }).catch(() => false))) {
    const seed = page.getByRole("button", { name: "See a sample audit" });
    if (await seed.isVisible({ timeout: 5_000 }).catch(() => false)) {
      const saved = page.waitForResponse(
        (response) => response.url().includes("/api/workspaces/current/audit-snapshot") && response.request().method() === "POST" && response.ok(),
        { timeout: 20_000 },
      );
      await seed.click();
      await saved;
      await nav.getByText("Connect", { exact: true }).click();
    }
  }
  await expect(panel).toBeVisible({ timeout: 30_000 });
  return panel;
}

// A rail card is the div that holds the rail title and its primary action button.
function railCard(panel: ReturnType<Page["locator"]>, title: string) {
  return panel
    .locator("div")
    .filter({ has: panel.page().getByText(title, { exact: true }) })
    .filter({ has: panel.page().getByRole("button", { name: /^(Connect|Not available yet|Disconnect|Reconnect|Continue approval|Approval pending)$/ }) })
    .last();
}

test("Email rail Connect button is wired: it fires the start endpoint and follows the returned authUrl", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await signIn(page, testInfo.project.name);

  // Ready path: the provider returns a real authUrl and the button must follow it.
  await page.route("**/api/integrations/gmail/start**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "ready", integration: "gmail-readonly", authUrl: "/login?connected=gmail-wiring-proof" }),
    }),
  );

  const panel = await openConnect(page);
  const card = railCard(panel, "Email receipts");
  const connect = card.getByRole("button", { name: "Connect", exact: true });
  await expect(connect).toBeEnabled();

  const started = page.waitForRequest((request) => request.url().includes("/api/integrations/gmail/start"), { timeout: 15_000 });
  await connect.click();
  await started; // the button really calls the endpoint — not a cosmetic control
  await page.waitForURL(/connected=gmail-wiring-proof/, { timeout: 15_000 });
  await page.unroute("**/api/integrations/gmail/start**");
});

test("Email rail degrades honestly when the provider is not activated (never a silent no-op)", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await signIn(page, testInfo.project.name);

  await page.route("**/api/integrations/gmail/start**", (route) =>
    route.fulfill({
      status: 501,
      contentType: "application/json",
      body: JSON.stringify({
        status: "not-available",
        integration: "gmail-readonly",
        availability: "company-activation-pending",
        message: "Email connection is not available yet.",
      }),
    }),
  );

  const panel = await openConnect(page);
  const card = railCard(panel, "Email receipts");
  const started = page.waitForRequest((request) => request.url().includes("/api/integrations/gmail/start"), { timeout: 15_000 });
  await card.getByRole("button", { name: "Connect", exact: true }).click();
  await started;

  // The one honest, observable outcome — the button self-labels its gated state
  // and stays disabled. A demo button would do nothing here.
  await expect(card.getByRole("button", { name: "Not available yet", exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(card.getByRole("button", { name: "Not available yet", exact: true })).toBeDisabled();
  await page.unroute("**/api/integrations/gmail/start**");
});

test("Bank rail validates the handle, then fires the AA consent endpoint", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await signIn(page, testInfo.project.name);

  const panel = await openConnect(page);
  const card = railCard(panel, "Bank transactions");

  // Empty handle: the control must give feedback (a notice), not fail silently,
  // and must NOT call the consent endpoint yet.
  let aaCalls = 0;
  await page.route("**/api/integrations/aa/start", (route) => {
    aaCalls += 1;
    return route.fulfill({
      status: 501,
      contentType: "application/json",
      body: JSON.stringify({ status: "not-available", integration: "account-aggregator", availability: "company-activation-pending", message: "Bank connection is not available yet." }),
    });
  });

  await card.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /Account Aggregator handle/i })).toBeVisible({ timeout: 10_000 });
  expect(aaCalls).toBe(0);

  // With a handle, the button fires the real consent endpoint.
  await card.getByPlaceholder("9999999999@onemoney").fill("9999999999@onemoney");
  const started = page.waitForRequest(
    (request) => request.url().includes("/api/integrations/aa/start") && request.method() === "POST",
    { timeout: 15_000 },
  );
  await card.getByRole("button", { name: "Connect", exact: true }).click();
  await started;
  expect(aaCalls).toBe(1);
  await page.unroute("**/api/integrations/aa/start");
});

test("no visible control on the workspace screens is a dead affordance", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await signIn(page, testInfo.project.name);
  // Seed the sample so every screen renders real content (and the empty-workspace
  // auto-route can't fight our navigation).
  await openConnect(page);
  const nav = page.locator('nav[aria-label="Workspace sections"]:visible');

  for (const screen of ["Home", "Subscriptions", "Connect"]) {
    await nav.getByText(screen, { exact: true }).click();
    await page.waitForTimeout(300);

    // Every visible, enabled button must expose a non-empty accessible name.
    const namelessButtons = await page.evaluate(() => {
      const nameless: string[] = [];
      for (const button of Array.from(document.querySelectorAll("button"))) {
        const rect = button.getBoundingClientRect();
        const visible = rect.width > 0 && rect.height > 0 && getComputedStyle(button).visibility !== "hidden";
        if (!visible) continue;
        const accessibleName = (button.getAttribute("aria-label") ?? button.textContent ?? "").replace(/\s+/g, " ").trim();
        if (!accessibleName) nameless.push(button.outerHTML.slice(0, 120));
      }
      return nameless;
    });
    expect(namelessButtons, `${screen}: buttons with no accessible name`).toEqual([]);

    // No visible link may point at a dead anchor.
    const deadLinks = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href="#"]'))
        .filter((anchor) => {
          const rect = anchor.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        })
        .map((anchor) => (anchor.textContent ?? "").trim() || anchor.outerHTML.slice(0, 120)),
    );
    expect(deadLinks, `${screen}: dead href="#" links`).toEqual([]);
  }
});
