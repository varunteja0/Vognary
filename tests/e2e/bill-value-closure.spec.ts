import { randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { ZohoBooksDetail, ZohoBooksState } from "../../src/lib/zoho-books/contracts";

const email = process.env.VOGNARY_E2E_DEV_LOGIN_EMAIL;
const accessCode = process.env.VOGNARY_E2E_DEV_LOGIN_CODE;
const billId = process.env.VOGNARY_E2E_BOOKS_BILL_ID;
test.skip(!email || !accessCode || !billId, "An isolated synthetic source and development identity are required.");

async function signIn(page: Page) {
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `2001:db8:${randomBytes(12).toString("hex").match(/.{4}/g)!.join(":")}` });
  expect((await page.request.post("/api/auth/login", { data: { email, accessCode } })).status()).toBe(200);
}

for (const scenario of [
  { name: "empty complete import", count: 0, status: "READY", configured: true, complete: true, stale: false, label: "Last import complete" },
  { name: "unchanged baseline import", count: 3, status: "READY", configured: true, complete: true, stale: false, label: "Last import complete" },
  { name: "partial initial import", count: 3, status: "SYNCING", configured: true, complete: false, stale: false, label: "Import incomplete" },
  { name: "missing permissions", count: 3, status: "REAUTH_REQUIRED", configured: true, complete: true, stale: false, label: "Reconnect required" },
  { name: "stale source", count: 3, status: "READY", configured: true, complete: true, stale: true, label: "Update overdue" },
  { name: "unavailable source", count: 3, status: "FAILED", configured: true, complete: true, stale: false, label: "Updates stopped" },
  { name: "unconfigured reads", count: 3, status: "READY", configured: false, complete: true, stale: false, label: "Provider reads not configured" },
] as const) {
  test(`first value and ordinary return remain honest for ${scenario.name}`, async ({ page }, testInfo) => {
    await signIn(page);
    const original: ZohoBooksState = (await (await page.request.get("/api/workspaces/current/sources/zoho-books?view=ALL&sort=UPDATED")).json()).data;
    const bills = Array.from({ length: scenario.count }, (_, index) => ({ ...original.items[0], sequence: String(800001 + index), bill: { ...original.items[0].bill, billId: String(800001 + index), billNumber: `SYNTHETIC-BASELINE-${index}`, vendorName: `Synthetic unchanged supplier ${index}` }, previous: null, previousChangeKind: null, changeKind: "BASELINE", disposition: null, reviewRelevance: "BASELINE", pendingReviewCount: 0, pendingReviewSequence: null, pendingReviewSince: null, lastResolvedReview: null, openFollowUpCount: 0 }));
    await page.route("**/sources/zoho-books?*", async route => {
      const all = new URL(route.request().url()).searchParams.get("view") === "ALL";
      await route.fulfill({ json: { data: { ...original, configured: scenario.configured, connection: { ...original.connection, status: scenario.status, lastSuccessfulSyncAt: scenario.complete ? new Date(Date.now() - (scenario.stale ? 172800000 : 60000)).toISOString() : null, nextScheduledAt: new Date(Date.now() + (scenario.stale ? -86400000 : 86400000)).toISOString(), incident: null }, items: all ? bills : [], total: all ? scenario.count : 0, throughSequence: "900000", nextCursor: null, overview: { billCount: scenario.count, changedBillCount: 0, needsReviewCount: 0, followUpCount: 0, closedCount: 0, oldestPendingObservedAt: null, earliestFollowUpOn: null } } } });
    });
    await page.goto("/app?view=BILL_REVIEW");
    const overview = page.getByRole("region", { name: "Available bill records" });
    await expect(overview).toContainText(`${scenario.count} available`);
    await expect(overview).toContainText("No complete-company coverage");
    await expect(overview).toContainText(scenario.label);
    await expect(page.getByRole("region", { name: "Supplier bill review" })).toContainText("No bill changes waiting");
    await page.getByRole("button", { name: "All bills", exact: true }).click();
    if (scenario.count) await expect(page.getByRole("table", { name: "Imported bill register" }).locator("tbody tr")).toHaveCount(scenario.count);
    else await expect(page.getByText("No bills in imported coverage", { exact: true })).toBeVisible();
    await page.reload();
    await expect(overview).toContainText(`${scenario.count} available`);
    await expect(overview).toContainText(scenario.label);
    expect(new URL(page.url()).searchParams.get("billView")).toBe("ALL");
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    expect((await new AxeBuilder({ page }).include('[aria-label="Supplier bill review"]').analyze()).violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`${scenario.name.replaceAll(" ", "-")}.png`), fullPage: true });
  });
}

test("routine status changes expose exact facts without requiring another explanation", async ({ page }, testInfo) => {
  await signIn(page);
  const original: ZohoBooksDetail = (await (await page.request.get(`/api/workspaces/current/sources/zoho-books/bills/${billId}`)).json()).data;
  const current = { ...original.current, sequence: "900000", previous: original.current.bill, previousChangeKind: "AMENDED", bill: { ...original.current.bill, status: "paid", balanceMinor: "0", sourceBalance: "0" }, disposition: null, reviewRelevance: "INFORMATIONAL", pendingReviewCount: 0, pendingReviewSequence: null, pendingReviewSince: null, lastResolvedReview: null, openFollowUpCount: 0 };
  await page.route(`**/sources/zoho-books/bills/${billId}*`, route => route.fulfill({ json: { data: { ...original, current, selected: current, observations: [current], events: [], openFollowUps: [], nextCursor: null, nextEventCursor: null, nextFollowUpCursor: null } } }));
  await page.goto(`/app?view=BILL_REVIEW&bill=${billId}&billView=ALL`);
  const detail = page.getByRole("region", { name: "Selected bill review" });
  await expect(detail).toContainText("Informational update");
  await expect(detail.getByRole("form", { name: "Bill disposition" })).not.toBeVisible();
  const changed = detail.getByRole("region", { name: "Changed source fields" });
  await expect(changed).toContainText("open");
  await expect(changed).toContainText("paid");
  await expect(changed).toContainText("INR 130");
  await expect(changed).toContainText("INR 0");
  await detail.getByRole("button", { name: "Record a review", exact: true }).click();
  await expect(detail.getByRole("form", { name: "Bill disposition" })).toBeVisible();
  await expect(detail).toContainText("No payment or supplier action");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.screenshot({ path: testInfo.outputPath("informational-source-difference.png"), fullPage: true });
});

test("a routine latest revision links directly to its older unanswered material review", async ({ page }) => {
  await signIn(page);
  const original: ZohoBooksDetail = (await (await page.request.get(`/api/workspaces/current/sources/zoho-books/bills/${billId}`)).json()).data;
  const question = { ...original.current, disposition: null, pendingReviewCount: 1, pendingReviewSequence: original.current.sequence, pendingReviewSince: original.current.observedAt, reviewRelevance: "MATERIAL" };
  const current = { ...question, sequence: "900000", previous: question.bill, previousChangeKind: "AMENDED", bill: { ...question.bill, status: "paid", balanceMinor: "0", sourceBalance: "0" }, reviewRelevance: "INFORMATIONAL" };
  await page.route(`**/sources/zoho-books/bills/${billId}*`, route => route.fulfill({ json: { data: { ...original, current, selected: new URL(route.request().url()).searchParams.has("revision") ? question : current, observations: [current, question], events: [], openFollowUps: [] } } }));
  await page.goto(`/app?view=BILL_REVIEW&bill=${billId}&billView=ALL`);
  const detail = page.getByRole("region", { name: "Selected bill review" });
  await detail.getByRole("button", { name: "Review earlier change", exact: true }).click();
  expect(new URL(page.url()).searchParams.get("billRevision")).toBe(question.sequence);
  await expect(detail.getByRole("form", { name: "Bill disposition" })).toBeVisible();
  await expect(detail).toContainText("Historical revision");
});

test("the bill register shows useful records before connection administration without policy setup", async ({ page }, testInfo) => {
  await signIn(page);
  await page.goto("/app?view=BILL_REVIEW&billView=ALL");
  const register = page.getByRole("table", { name: "Imported bill register" });
  await expect(register.locator("tbody tr")).toHaveCount(50, { timeout: 30000 });
  await page.screenshot({ path: testInfo.outputPath("first-useful-register.png"), fullPage: false });
  const firstBill = await register.locator("tbody tr").first().getByRole("link").boundingBox();
  const navigationHeight = await page.getByRole("navigation", { name: "Primary" }).evaluate(element => getComputedStyle(element).position === "fixed" ? element.getBoundingClientRect().height : 0);
  expect(firstBill).not.toBeNull();
  expect(firstBill!.y + firstBill!.height).toBeLessThanOrEqual((page.viewportSize()?.height ?? 900) - navigationHeight);
  const firstAmount = await register.locator("tbody tr").first().locator("td").nth(1).locator("span").first().boundingBox();
  expect(firstAmount).not.toBeNull();
  expect(firstAmount!.y + firstAmount!.height).toBeLessThanOrEqual((page.viewportSize()?.height ?? 900) - navigationHeight);
  const connection = await page.getByText("Connection and import status", { exact: true }).boundingBox();
  expect(connection!.y).toBeGreaterThan(firstBill!.y);
  await expect(page.getByRole("dialog", { name: /policy/i })).toHaveCount(0);
  await page.getByText("Sort and currency", { exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Sort by" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Currency", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Currency", exact: true }).selectOption("INR");
  await expect(page.getByRole("combobox", { name: "Currency", exact: true })).toHaveValue("INR");
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Currency", exact: true })).toHaveValue("INR");
  expect(new URL(page.url()).searchParams.get("billCurrency")).toBe("INR");
});

test("a tab reconciles a missed sign-out on hydration and return from suspension", async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("vognary.auth-event", "synthetic-old-event");
    sessionStorage.setItem("vognary.bill-draft.synthetic-late", "Synthetic private draft");
    localStorage.setItem("vognary.auth-event", "synthetic-missed-signout");
  });
  await page.goto("/privacy");
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("vognary.bill-draft.synthetic-late"))).toBeNull();
  await page.evaluate(() => {
    sessionStorage.setItem("vognary.bill-draft.synthetic-late", "Synthetic suspended draft");
    localStorage.setItem("vognary.auth-event", "synthetic-later-signout");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("vognary.bill-draft.synthetic-late"))).toBeNull();
});
