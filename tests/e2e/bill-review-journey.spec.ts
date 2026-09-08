import { randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const email = process.env.VOGNARY_E2E_DEV_LOGIN_EMAIL;
const accessCode = process.env.VOGNARY_E2E_DEV_LOGIN_CODE;
const billId = process.env.VOGNARY_E2E_BOOKS_BILL_ID;
test.skip(!email || !accessCode || !billId, "An explicitly seeded synthetic Books bill and local development login are required.");

async function signIn(page: Page) {
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `2001:db8:${randomBytes(12).toString("hex").match(/.{4}/g)!.join(":")}` });
  const response = await page.request.post("/api/auth/login", { data: { email, accessCode } });
  expect(response.status()).toBe(200);
}

async function openReviewForm(page: Page) {
  const detail = page.getByRole("region", { name: "Selected bill review" });
  await expect(detail.getByRole("heading", { name: "Synthetic resolution supplier" })).toBeVisible({ timeout: 30000 });
  const further = detail.getByRole("button", { name: "Record a further review", exact: true });
  if (await further.isVisible()) await further.click();
  return detail.getByRole("form", { name: "Bill disposition" });
}

test("real saved bill review completes follow-up, closure, copied URL and returning history", async ({ page }, testInfo) => {
  await signIn(page);
  await page.goto(`/app?view=BILL_REVIEW&bill=${billId}&billView=ALL`);
  const detail = page.getByRole("region", { name: "Selected bill review" });
  await expect(detail.getByRole("heading", { name: "Synthetic resolution supplier" })).toBeVisible({ timeout: 30000 });
  await expect(detail.getByLabel("Exact bill total comparison").getByText("INR 130", { exact: true })).toBeVisible();
  await expect(detail.getByLabel("Exact bill total comparison").getByText("INR 120", { exact: true })).toBeVisible();
  const comparison = await detail.getByLabel("Exact bill total comparison").boundingBox();
  expect(comparison).not.toBeNull();
  const navigationHeight = await page.getByRole("navigation", { name: "Primary" }).evaluate(element => getComputedStyle(element).position === "fixed" ? element.getBoundingClientRect().height : 0);
  expect(comparison!.y + comparison!.height).toBeLessThan((page.viewportSize()?.height ?? 900) - navigationHeight);
  const screenshot = (name: string) => page.screenshot({ path: testInfo.outputPath(name), fullPage: true });
  await screenshot("bill-review-before-disposition.png");
  const form = await openReviewForm(page);
  await form.getByRole("radio", { name: "Follow up", exact: true }).check();
  await form.getByLabel("Explanation", { exact: true }).fill("Synthetic supplier clarification is needed before this review can be closed.");
  await form.getByLabel("Follow-up date", { exact: false }).fill("2026-12-01");
  await form.getByRole("button", { name: "Save follow-up" }).click();
  await expect(detail.getByRole("heading", { name: "Open follow-ups" })).toBeVisible();
  const link = page.url();
  await page.reload();
  await expect(detail.getByRole("heading", { name: "Open follow-ups" })).toBeVisible();
  await form.getByLabel("Explanation", { exact: true }).fill("Synthetic supplier explained the amendment. Human review closed; no payment is asserted.");
  await form.getByRole("radio", { name: "Close review", exact: true }).check();
  await form.getByRole("button", { name: "Close this review" }).click();
  await expect(detail.getByRole("status").filter({ hasText: "Review closed" })).toBeVisible();
  await expect(detail.getByRole("heading", { name: "Open follow-ups" })).toHaveCount(0);
  await page.goto(link);
  await expect(detail.getByText("Synthetic supplier explained the amendment. Human review closed; no payment is asserted.").first()).toBeVisible();
  await expect(detail.getByText(/Recorded by/)).toBeVisible();
  await page.getByRole("navigation", { name: "Primary" }).getByLabel("Records", { exact: true }).click();
  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Decisions", exact: false }).click();
  await page.goBack();
  await expect(detail.getByRole("heading", { name: "Synthetic resolution supplier" })).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).include('[aria-label="Supplier bill review"]').analyze();
  expect(accessibility.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await screenshot("bill-review-closed-return.png");
});

test("a lost disposition response retries the original request exactly once after reload", async ({ page }) => {
  await signIn(page);
  await page.goto(`/app?view=BILL_REVIEW&bill=${billId}&billView=ALL`);
  const form = await openReviewForm(page);
  await expect(form).toBeVisible({ timeout: 30000 });
  const keys: string[] = [];
  let dropped = false;
  await page.route(`**/sources/zoho-books/bills/${billId}`, async route => {
    if (route.request().method() !== "POST") return route.continue();
    keys.push(route.request().headers()["idempotency-key"]);
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    if (!dropped) { dropped = true; return route.abort("failed"); }
    return route.fulfill({ response });
  });
  const explanation = `Synthetic interrupted review ${Date.now()}.`;
  await form.getByLabel("Explanation", { exact: true }).fill(explanation);
  await form.getByRole("button", { name: "Close this review" }).click();
  await expect(form.getByRole("alert")).toContainText("unconfirmed");
  await page.reload();
  await expect(form.getByRole("button", { name: "Retry original save" })).toBeVisible();
  await form.getByRole("button", { name: "Retry original save" }).click();
  await expect(form.getByRole("alert")).toHaveCount(0);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  const history = page.getByRole("region", { name: "Selected bill review" }).getByText(explanation, { exact: true });
  await expect(history).toHaveCount(2);
});

test("bill filters, keyboard selection, copied revision links and acknowledgement retain one record", async ({ page, context }, testInfo) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page);
  await page.goto("/app?view=BILL_REVIEW&billView=ALL");
  const views = page.getByRole("navigation", { name: "Bill review views" });
  for (const label of ["Needs review", "Follow-ups", "Closed", "All bills"]) {
    await views.getByRole("button", { name: label, exact: true }).click();
    await expect(views.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
  }
  await page.getByRole("searchbox").fill("SYNTHETIC-RESOLUTION-001");
  await page.getByRole("button", { name: "Search bills", exact: true }).click();
  const bill = page.getByRole("link").filter({ hasText: "Synthetic resolution supplier" }).first();
  await bill.focus();
  await page.keyboard.press("Enter");
  const detail = page.getByRole("region", { name: "Selected bill review" });
  await expect(detail.getByRole("heading", { name: "Synthetic resolution supplier" })).toBeVisible();
  await expect(detail.getByRole("heading", { name: "Synthetic resolution supplier" })).toBeFocused();
  await detail.getByRole("button", { name: "Copy bill review link" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());
  await detail.getByText("Source identity and observation times", { exact: true }).click();
  await expect(detail.getByText(new RegExp(`bill ${billId}`))).toBeVisible();
  await detail.getByText("Reading acknowledgement", { exact: true }).click();
  await detail.getByRole("button", { name: "Acknowledge reading only" }).click();
  await expect(detail.getByRole("status").filter({ hasText: "Reading acknowledged for this exact revision" })).toBeVisible();
  await detail.getByText("Source revision history", { exact: true }).click();
  const revisions = detail.getByRole("button", { name: /Revision \d+ \/ (baseline|amended)/ });
  await expect(revisions).toHaveCount(2);
  await revisions.last().click();
  await expect(detail.getByText(/Historical revision/)).toBeVisible();
  const historicalUrl = page.url();
  const second = await context.newPage();
  await second.goto(historicalUrl);
  await expect(second.getByText(/Historical revision/)).toBeVisible();
  await second.close();
  await detail.getByRole("button", { name: "Open current revision" }).click();
  await expect(detail.getByText(/Historical revision/)).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("bill-review-keyboard-reduced-motion.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test("read-only and malformed bill detail states cannot expose a writable disposition", async ({ page }) => {
  await signIn(page);
  let malformed = false;
  await page.route(`**/sources/zoho-books/bills/${billId}?*`, async route => {
    if (route.request().method() !== "GET") return route.continue();
    if (malformed) return route.fulfill({ json: { data: { current: { bill: { totalMinor: "NaN" } } } } });
    const response = await route.fetch();
    const payload = await response.json();
    return route.fulfill({ json: { ...payload, data: { ...payload.data, canManage: false } } });
  });
  await page.goto(`/app?view=BILL_REVIEW&bill=${billId}&billView=ALL`);
  const detail = page.getByRole("region", { name: "Selected bill review" });
  await expect(detail.getByText(/Read-only access/)).toBeVisible();
  await expect(detail.getByRole("form", { name: "Bill disposition" })).toHaveCount(0);
  malformed = true;
  await page.reload();
  await expect(detail.getByRole("alert")).toContainText("could not be verified");
  await expect(detail.getByRole("form", { name: "Bill disposition" })).toHaveCount(0);
  await expect(detail.getByText("NaN", { exact: true })).toHaveCount(0);
});

test("an interrupted older-revision save survives a newer source revision and access loss clears controls", async ({ page }) => {
  await signIn(page);
  let newer = false;
  let denied = false;
  const writes: Array<Record<string, unknown>> = [];
  await page.route(`**/sources/zoho-books/bills/${billId}*`, async route => {
    if (route.request().method() === "POST") {
      writes.push(route.request().postDataJSON());
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      if (writes.length === 1) return route.abort("failed");
      return route.fulfill({ response });
    }
    if (denied) return route.fulfill({ status: 403, json: { error: { code: "FORBIDDEN" } } });
    const response = await route.fetch();
    const payload = await response.json();
    if (newer) {
      const current = { ...payload.data.current, sequence: "9223372036854775806", disposition: null };
      payload.data = { ...payload.data, current, selected: current };
    }
    return route.fulfill({ json: payload });
  });
  await page.goto(`/app?view=BILL_REVIEW&bill=${billId}&billView=ALL`);
  const detail = page.getByRole("region", { name: "Selected bill review" });
  const form = await openReviewForm(page);
  await form.getByLabel("Explanation", { exact: true }).fill("Synthetic older revision reviewed before the next source update.");
  await form.getByRole("button", { name: "Close this review" }).click();
  await expect(form.getByRole("alert")).toContainText("unconfirmed");
  newer = true;
  await page.reload();
  await expect(form.getByRole("button", { name: "Retry original save" })).toBeVisible();
  await form.getByRole("button", { name: "Retry original save" }).click();
  expect(writes).toHaveLength(2);
  expect(writes[0]).toEqual(writes[1]);
  await expect(detail.getByRole("status").filter({ hasText: "Review closed" })).toHaveCount(0);
  denied = true;
  await detail.getByRole("button", { name: "Reload selected bill" }).click();
  await expect(detail.getByRole("alert")).toBeVisible();
  await expect(detail.getByRole("form", { name: "Bill disposition" })).toHaveCount(0);
});

test("a closed review shows its result and keeps further work on demand", async ({ page }, testInfo) => {
  await signIn(page);
  await page.goto(`/app?view=BILL_REVIEW&bill=${billId}&billView=ALL`);
  const detail = page.getByRole("region", { name: "Selected bill review" });
  await expect(detail.getByRole("heading", { name: "Synthetic resolution supplier" })).toBeVisible({ timeout: 30000 });
  const saved = detail.getByRole("status").filter({ hasText: "Review closed" });
  await expect(saved).toBeVisible();
  await expect(detail.getByRole("form", { name: "Bill disposition" })).not.toBeVisible();
  await expect(detail.getByRole("button", { name: "Acknowledge reading only" })).not.toBeVisible();
  await expect(detail.getByRole("heading", { name: "Human review history" })).not.toBeVisible();
  const back = detail.getByRole("button", { name: "Return to bills" });
  await expect(back).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("closed-result-hierarchy.png"), fullPage: true });
  const savedBox = await saved.boundingBox();
  const comparisonBox = await detail.getByLabel("Exact bill total comparison").boundingBox();
  expect(savedBox).not.toBeNull();
  expect(comparisonBox).not.toBeNull();
  expect(savedBox!.y + savedBox!.height).toBeLessThanOrEqual(comparisonBox!.y);
  const backBox = await back.boundingBox();
  const navigationHeight = await page.getByRole("navigation", { name: "Primary" }).evaluate(element => getComputedStyle(element).position === "fixed" ? element.getBoundingClientRect().height : 0);
  expect(backBox!.y + backBox!.height).toBeLessThanOrEqual((page.viewportSize()?.height ?? 900) - navigationHeight);
  await expect(page.getByRole("dialog", { name: /policy/i })).toHaveCount(0);
  await detail.getByRole("button", { name: "Record a further review" }).click();
  await expect(detail.getByRole("form", { name: "Bill disposition" })).toBeVisible();
});

test("closed review reading and audit details remain available on demand", async ({ page }) => {
  await signIn(page);
  await page.goto(`/app?view=BILL_REVIEW&bill=${billId}&billView=ALL`, { waitUntil: "domcontentloaded" });
  const detail = page.getByRole("region", { name: "Selected bill review" });
  await expect(detail.getByRole("heading", { name: "Synthetic resolution supplier" })).toBeVisible({ timeout: 30000 });
  await detail.getByText("Reading acknowledgement", { exact: true }).click();
  await expect(detail.getByRole("button", { name: "Acknowledge reading only" })).toBeVisible();
  await detail.getByText("Review history", { exact: true }).click();
  await expect(detail.getByRole("heading", { name: "Human review history" })).toBeVisible();
});

test("a signed-out copied bill URL survives sign-in with its register context", async ({ page }) => {
  const target = `/app?view=BILL_REVIEW&bill=${billId}&billView=ALL&billSearch=Synthetic&billSort=SUPPLIER`;
  await page.goto(target);
  expect(new URL(page.url()).pathname).toBe("/login");
  expect(new URL(page.url()).searchParams.get("next")).toBe(target);
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `2001:db8:${randomBytes(12).toString("hex").match(/.{4}/g)!.join(":")}` });
  await page.getByText("Other ways to sign in").click();
  await page.getByPlaceholder("developer@example.com").fill(email!);
  await page.getByPlaceholder("Access code").fill(accessCode!);
  await Promise.all([page.waitForURL(value => value.pathname === "/app"), page.getByRole("button", { name: "Sign in as developer" }).click()]);
  expect(new URL(page.url()).search).toBe(new URL(target, "http://localhost").search);
  await expect(page.getByRole("region", { name: "Selected bill review" }).getByRole("heading", { name: "Synthetic resolution supplier" })).toBeVisible({ timeout: 30000 });
});

test("sign-out clears transient data across tabs without revoking source access", async ({ page, context }) => {
  await signIn(page);
  const before = (await (await page.request.get("/api/workspaces/current/sources/zoho-books")).json()).data.connection;
  await page.goto("/profile", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  const peer = await context.newPage();
  await peer.goto("/privacy", { waitUntil: "domcontentloaded" });
  for (const tab of [page, peer]) await tab.evaluate(() => {
    sessionStorage.setItem("vognary.bill-draft.synthetic", "Synthetic private draft");
    sessionStorage.setItem("vognary.control-provider-bill.synthetic", "Synthetic original comparison request");
  });
  await page.route("**/api/auth/logout", route => route.fulfill({ status: 503, json: { status: "revocation-pending" } }));
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByText("Could not sign out. Please retry.")).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("vognary.bill-draft.synthetic"))).toBe("Synthetic private draft");
  expect(await page.evaluate(() => sessionStorage.getItem("vognary.control-provider-bill.synthetic"))).toBe("Synthetic original comparison request");
  await page.unroute("**/api/auth/logout");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.waitForURL(value => value.pathname === "/login");
  await expect.poll(() => peer.evaluate(() => sessionStorage.getItem("vognary.bill-draft.synthetic"))).toBeNull();
  await expect.poll(() => peer.evaluate(() => sessionStorage.getItem("vognary.control-provider-bill.synthetic"))).toBeNull();
  expect(await page.evaluate(() => sessionStorage.getItem("vognary.bill-draft.synthetic"))).toBeNull();
  expect(await page.evaluate(() => sessionStorage.getItem("vognary.control-provider-bill.synthetic"))).toBeNull();
  expect((await (await page.request.get("/api/auth/session")).json()).authenticated).toBe(false);
  await signIn(page);
  const after = (await (await page.request.get("/api/workspaces/current/sources/zoho-books")).json()).data.connection;
  expect(after.id).toBe(before.id);
  expect(after.status).toBe(before.status);
  await peer.close();
});

test("bill register searches on the server and preserves filters through a selected record", async ({ page }) => {
  await signIn(page);
  await page.goto("/app?view=BILL_REVIEW&billView=ALL&billSort=SUPPLIER", { waitUntil: "domcontentloaded" });
  const register = page.getByRole("table", { name: "Imported bill register" });
  await expect(register.locator("tbody tr")).toHaveCount(50, { timeout: 30000 });
  const request = page.waitForResponse(response => new URL(response.url()).searchParams.get("search") === "SYNTHETIC-RESOLUTION-001");
  await page.getByRole("searchbox").fill("SYNTHETIC-RESOLUTION-001");
  await page.getByRole("button", { name: "Search bills", exact: true }).click();
  expect((await request).status()).toBe(200);
  await expect(register.locator("tbody tr")).toHaveCount(1);
  const row = register.getByRole("link", { name: "Synthetic resolution supplier" });
  const selectedResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/workspaces/current/sources/zoho-books/bills/${billId}` && response.request().method() === "GET");
  await row.click();
  const loaded = await selectedResponse;
  expect(loaded.status()).toBe(200);
  await loaded.finished();
  const detail = page.getByRole("region", { name: "Selected bill review" });
  await expect(detail.getByRole("button", { name: "Return to bills" })).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(detail.getByRole("button", { name: "Return to bills" })).toBeVisible({ timeout: 30000 });
  await detail.getByRole("button", { name: "Return to bills" }).click();
  await expect(page.getByRole("searchbox")).toHaveValue("SYNTHETIC-RESOLUTION-001");
  await expect(page.getByRole("combobox", { name: "Sort by" })).toHaveValue("SUPPLIER");
  await expect(row).toBeFocused();
  expect(new URL(page.url()).searchParams.get("billSearch")).toBe("SYNTHETIC-RESOLUTION-001");
});

test("bill register pages remain bounded and money sorting never loses a minor unit", async ({ page, context }) => {
  await signIn(page);
  await page.goto("/app?view=BILL_REVIEW&billView=ALL&billSort=AMOUNT_DESC&billCurrency=INR", { waitUntil: "domcontentloaded" });
  const register = page.getByRole("table", { name: "Imported bill register" });
  await expect(register.locator("tbody tr")).toHaveCount(50, { timeout: 30000 });
  await expect(register.locator("tbody tr").first()).toContainText("9,00,71,99,25,47,409.93");
  const first = (await register.locator("tbody tr").first().textContent())!;
  await page.getByRole("navigation", { name: "Bill register pages" }).getByRole("button", { name: "Next", exact: true }).click();
  await expect(register.locator("tbody tr").first()).not.toHaveText(first);
  await expect(register.locator("tbody tr")).toHaveCount(50);
  expect(new URL(page.url()).searchParams.get("billCursor")).toMatch(/^r1\./);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(register.locator("tbody tr")).toHaveCount(50, { timeout: 30000 });
  await page.getByRole("navigation", { name: "Bill register pages" }).getByRole("button", { name: "Previous", exact: true }).click();
  await expect(register.locator("tbody tr").first()).toHaveText(first);
  await page.getByRole("navigation", { name: "Bill register pages" }).getByRole("button", { name: "Next", exact: true }).click();
  await expect(register.locator("tbody tr").first()).not.toHaveText(first);
  const copied = await context.newPage();
  await copied.goto(page.url(), { waitUntil: "domcontentloaded" });
  await expect(copied.getByRole("table", { name: "Imported bill register" }).locator("tbody tr")).toHaveCount(50, { timeout: 30000 });
  await expect(copied.getByRole("navigation", { name: "Bill register pages" }).getByRole("button", { name: "Previous", exact: true })).toBeDisabled();
  await expect(copied.getByRole("navigation", { name: "Bill register pages" }).getByRole("button", { name: "First page", exact: true })).toBeEnabled();
  await copied.close();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test("an unfinished explanation survives reload and a recoverable refusal", async ({ page }) => {
  await signIn(page);
  await page.goto(`/app?view=BILL_REVIEW&bill=${billId}&billView=ALL`, { waitUntil: "domcontentloaded" });
  const form = await openReviewForm(page);
  const note = "Synthetic draft retained for a later human review.";
  await form.getByLabel("Explanation", { exact: true }).fill(note);
  await form.getByRole("radio", { name: "Follow up", exact: true }).check();
  await form.getByLabel("Follow-up date", { exact: false }).fill("2026-12-01");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("region", { name: "Selected bill review" }).getByRole("heading", { name: "Synthetic resolution supplier" })).toBeVisible({ timeout: 30000 });
  await expect(form).toBeVisible({ timeout: 30000 });
  await expect(form.getByLabel("Explanation", { exact: true })).toHaveValue(note);
  await expect(form.getByRole("radio", { name: "Follow up", exact: true })).toBeChecked();
  await expect(form.getByLabel("Follow-up date", { exact: false })).toHaveValue("2026-12-01");
  await page.route(`**/sources/zoho-books/bills/${billId}`, route => route.request().method() === "POST" ? route.fulfill({ status: 409, json: { error: { code: "STALE_STATE" } } }) : route.continue());
  await form.getByRole("button", { name: "Save follow-up" }).click();
  await expect(form.getByRole("alert")).toContainText("changed");
  await expect(form.getByLabel("Explanation", { exact: true })).toHaveValue(note);
  await expect(form.getByLabel("Follow-up date", { exact: false })).toHaveValue("2026-12-01");
});

test("bill work reflows with long records, enlarged text and reduced motion", async ({ page }, testInfo) => {
  await signIn(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/app?view=BILL_REVIEW&billView=ALL&billSort=SUPPLIER", { waitUntil: "domcontentloaded" });
  const register = page.getByRole("table", { name: "Imported bill register" });
  await expect(register.locator("tbody tr")).toHaveCount(50, { timeout: 30000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  const registerAccessibility = await new AxeBuilder({ page }).include('[aria-label="Supplier bill review"]').analyze();
  expect(registerAccessibility.violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("register-320-long-records.png"), fullPage: true });
  await page.goto(`/app?view=BILL_REVIEW&bill=${billId}&billView=ALL`, { waitUntil: "domcontentloaded" });
  const form = await openReviewForm(page);
  await page.addStyleTag({ content: "html { font-size: 200%; }" });
  await form.getByRole("radio", { name: "Follow up", exact: true }).check();
  await expect(form.getByLabel("Follow-up date", { exact: true })).toBeVisible();
  await expect(form.getByLabel("Explanation", { exact: true })).toHaveAccessibleName("Explanation");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  const detailAccessibility = await new AxeBuilder({ page }).include('[aria-label="Selected bill review"]').analyze();
  expect(detailAccessibility.violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("detail-320-text-200-percent.png"), fullPage: true });
});
