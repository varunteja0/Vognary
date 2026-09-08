import { expect, test, type Page, type TestInfo, type Locator, type BrowserContext } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { a2CandidatePage, a2ComparisonResponse, a2Evaluation, a2Ids } from "./fixtures/a2-provider-bill";

test.skip(!process.env.VOGNARY_E2E_DEV_LOGIN_EMAIL || !process.env.VOGNARY_E2E_DEV_LOGIN_CODE, "Requires synthetic development login");

test.beforeEach(async ({ context, page }) => {
  page.setDefaultTimeout(15_000);
  await context.setExtraHTTPHeaders({ "x-forwarded-for": `2001:db8:${randomBytes(12).toString("hex").match(/.{4}/g)!.join(":")}` });
});

test("A2 explicit amount basis and bill selection preserve human acknowledgement", async ({ page }) => {
  const login = await page.request.post("/api/auth/login", { data: { email: process.env.VOGNARY_E2E_DEV_LOGIN_EMAIL, accessCode: process.env.VOGNARY_E2E_DEV_LOGIN_CODE } });
  expect(login.status()).toBe(200);
  await page.route("**/control/brief", route => route.fulfill({ json: {
    data: { policy: null, proposals: [{ proposal: a2ComparisonResponse.proposal, evaluation: a2Evaluation, decision: a2ComparisonResponse.decision, reconciliations: [], outcomeObservations: [], exceptionReviews: [] }], capabilities: { canSubmitProposal: true, canDecide: true, canConfigurePolicy: true } },
    meta: { requestId: "synthetic-a2", workspaceVersion: 3 },
  } }));
  await page.route("**/reconciliation-candidates?source=ZOHO_BOOKS*", route => route.fulfill({ json: { data: a2CandidatePage, meta: { requestId: "synthetic-a2", workspaceVersion: 3 } } }));
  await page.goto("/app?view=CONTROL");
  await page.getByRole("button", { name: "Compare a bill", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Compare a bill" });
  await dialog.getByRole("radio", { name: "Zoho Books", exact: true }).check();
  await dialog.getByRole("radio", { name: /SYNTHETIC-A2/ }).check();
  await expect(dialog.getByRole("button", { name: "Save billed comparison" })).toBeDisabled();
  await dialog.getByLabel("This entire bill is for this approved charge", { exact: true }).check();
  await expect(dialog.getByRole("button", { name: "Save billed comparison" })).toBeDisabled();
  await dialog.getByLabel(/Keep this selected bill and comparison/).check();
  await expect(dialog.getByRole("button", { name: "Save billed comparison" })).toBeEnabled();
});

test("A2 saved comparison preserves bill language, exact link and older and newer responsibility", async ({ page }) => {
  expect((await page.request.post("/api/auth/login", { data: { email: process.env.VOGNARY_E2E_DEV_LOGIN_EMAIL, accessCode: process.env.VOGNARY_E2E_DEV_LOGIN_CODE } })).status()).toBe(200);
  await page.route("**/control/brief", route => route.fulfill({ json: {
    data: { policy: null, proposals: [{ proposal: a2ComparisonResponse.proposal, evaluation: a2Evaluation, decision: a2ComparisonResponse.decision,
      reconciliations: [{ ...a2ComparisonResponse.reconciliation, providerBillSource: { condition: "AMENDED", latestSequence: "136", currentStatus: "READY", currentReviewRelevance: "MATERIAL", freshness: a2CandidatePage.freshness, pendingMaterialNewerCount: 1, pendingMaterialNewerSequences: ["136"], pendingMaterialOlderCount: 1, pendingMaterialOlderSequences: ["134"], openFollowUpCount: 1, billReviewPath: "/app?view=BILL_REVIEW&bill=200001" } }], outcomeObservations: [], exceptionReviews: [] }],
      capabilities: { canSubmitProposal: true, canDecide: true, canConfigurePolicy: true } }, meta: { requestId: "synthetic-a2", workspaceVersion: 3 },
  } }));
  await page.goto(`/app?view=CONTROL&proposal=${a2Ids.proposal}&comparison=${a2Ids.comparison}`);
  const saved = page.getByRole("region", { name: "Saved billed comparison" });
  await expect(saved.getByRole("heading", { name: "Saved billed comparison" })).toBeVisible();
  await expect(saved.getByText("Bill total", { exact: true })).toBeVisible();
  await expect(saved.getByText("Bill matches the agreed amount", { exact: true })).toBeVisible();
  await expect(saved.getByText(/1 newer material revision/)).toBeVisible();
  await expect(saved.getByText(/1 older material revision/)).toBeVisible();
  await expect(saved.getByText(/1 open follow-up/)).toBeVisible();
  await expect(saved.getByRole("button", { name: "Open the observed receipt" })).toHaveCount(0);
  await saved.getByText("Original bill and selection record", { exact: true }).click();
  await expect(saved.getByText(a2Ids.connection, { exact: false })).toBeVisible();
  await expect(saved.getByRole("link", { name: "Open this comparison", exact: true })).toHaveAttribute("href", `/app?view=CONTROL&proposal=${a2Ids.proposal}&comparison=${a2Ids.comparison}`);
});

test("A2 source erasure requires the current retained-admission acknowledgement", async ({ page }) => {
  expect((await page.request.post("/api/auth/login", { data: { email: process.env.VOGNARY_E2E_DEV_LOGIN_EMAIL, accessCode: process.env.VOGNARY_E2E_DEV_LOGIN_CODE } })).status()).toBe(200);
  let retainedAdmissionCount = 2;
  const writes: unknown[] = [];
  await page.route("**/sources/zoho-books**", route => {
    if (route.request().method() === "POST") {
      writes.push(route.request().postDataJSON());
      return route.fulfill({ status: 400, json: { error: { message: "Acknowledge the current retained admission count." } } });
    }
    return route.fulfill({ json: { data: { configured: false, canManage: true, retainedAdmissionCount, retentionNotice: "control-provider-bill-retention-v1", organizations: [], items: [], total: 0, nextCursor: null, throughSequence: "0",
      connection: { id: a2Ids.connection, revision: "4", status: "REVOKED", organizationId: "100001", organizationName: "Synthetic A2 organization", coverageStart: "2026-06-01", lastSuccessfulSyncAt: null, nextScheduledAt: null, failureCode: null, providerRevocation: "CONFIRMED" } } } });
  });
  await page.goto("/app?view=ADD_EVIDENCE");
  const source = page.getByRole("region", { name: "Zoho Books" });
  await source.getByRole("button", { name: "Delete observations" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete Books observations" });
  await expect(dialog.getByText(/^2 admitted bill records/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Delete observations" })).toBeDisabled();
  await dialog.getByRole("checkbox", { name: /I understand/ }).check();
  retainedAdmissionCount = 3;
  await dialog.getByRole("button", { name: "Delete observations" }).click();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ action: "ERASE", retentionAcknowledgement: { noticeVersion: "control-provider-bill-retention-v1", retainAdmitted: true, retainedAdmissionCount: 2 } });
  await expect(dialog.getByText(/^3 admitted bill records/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Delete observations" })).toBeDisabled();
});

for (const mode of ["STALE", "DENIED", "INVALID", "PARTIAL", "EMPTY"] as const) {
  test(`A2 ${mode.toLowerCase()} source cannot expose a new financial confirmation`, async ({ page }, testInfo) => {
    expect((await page.request.post("/api/auth/login", { data: { email: process.env.VOGNARY_E2E_DEV_LOGIN_EMAIL, accessCode: process.env.VOGNARY_E2E_DEV_LOGIN_CODE } })).status()).toBe(200);
    await page.route("**/control/brief", route => route.fulfill({ json: { data: { policy: null,
      proposals: [{ proposal: a2ComparisonResponse.proposal, evaluation: a2Evaluation, decision: a2ComparisonResponse.decision, reconciliations: [], outcomeObservations: [], exceptionReviews: [] }],
      capabilities: { canSubmitProposal: true, canDecide: true, canConfigurePolicy: true } }, meta: { requestId: "synthetic-negative", workspaceVersion: 3 } } }));
    await page.route("**/reconciliation-candidates?source=ZOHO_BOOKS*", route => {
      if (mode === "DENIED") return route.fulfill({ status: 403, json: { error: { code: "FORBIDDEN", message: "An owner or admin is required.", retryable: false, requestId: "synthetic-denied" } } });
      const data = mode === "INVALID" ? { ...a2CandidatePage, candidates: [{ ...a2CandidatePage.candidates[0], totalMinor: "NaN" }] }
        : mode === "EMPTY" ? { ...a2CandidatePage, candidates: [], total: 0, freshness: { ...a2CandidatePage.freshness, status: "UNAVAILABLE" }, connectionId: null, organizationId: null, expectedSourceVersion: null }
        : { ...a2CandidatePage, freshness: { ...a2CandidatePage.freshness, status: mode === "STALE" ? "STALE" : "UNAVAILABLE" }, candidates: [{ ...a2CandidatePage.candidates[0], canSelect: false, selectionReasons: [mode === "STALE" ? "SOURCE_STALE" : "SOURCE_NOT_READY"] }] };
      return route.fulfill({ json: { data, meta: { requestId: "synthetic-negative", workspaceVersion: 3 } } });
    });
    await page.goto("/app?view=CONTROL");
    await page.getByRole("button", { name: "Compare a bill", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Compare a bill" });
    await dialog.getByRole("radio", { name: "Zoho Books", exact: true }).check();
    await expect(dialog.getByRole("link", { name: "Open Books source settings" })).toBeVisible();
    if (mode === "DENIED" || mode === "INVALID") {
      await expect(dialog.getByRole("alert")).toBeVisible();
      await expect(dialog.getByText("NaN", { exact: true })).toHaveCount(0);
      await expect(dialog.getByText(/Bill total INR/)).toHaveCount(0);
    } else if (mode === "EMPTY") await expect(dialog.getByText(/No bills are available/)).toBeVisible();
    else await expect(dialog.getByRole("radio", { name: /SYNTHETIC-A2/ })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Save billed comparison" })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`${mode.toLowerCase()}-source.png`), fullPage: true });
    if (mode === "EMPTY") {
      await dialog.getByRole("link", { name: "Open Books source settings" }).click();
      await expect(page.getByRole("region", { name: "Zoho Books", exact: true })).toBeVisible();
    }
  });
}

test("A2 stale confirmation requires a fresh selection and both acknowledgements again", async ({ page }) => {
  expect((await page.request.post("/api/auth/login", { data: { email: process.env.VOGNARY_E2E_DEV_LOGIN_EMAIL, accessCode: process.env.VOGNARY_E2E_DEV_LOGIN_CODE } })).status()).toBe(200);
  const identity = (await (await page.request.get("/api/auth/session")).json()).session;
  await page.route("**/control/brief", route => route.fulfill({ json: { data: { policy: null,
    proposals: [{ proposal: a2ComparisonResponse.proposal, evaluation: a2Evaluation, decision: a2ComparisonResponse.decision, reconciliations: [], outcomeObservations: [], exceptionReviews: [] }],
    capabilities: { canSubmitProposal: true, canDecide: true, canConfigurePolicy: true } }, meta: { requestId: "synthetic-stale", workspaceVersion: 3 } } }));
  await page.route("**/reconciliation-candidates?source=ZOHO_BOOKS*", route => route.fulfill({ json: { data: a2CandidatePage, meta: { requestId: "synthetic-stale", workspaceVersion: 3 } } }));
  let writes = 0;
  await page.route("**/reconciliations", route => {
    writes += 1;
    expect(route.request().headers()["x-vognary-workspace"]).toBe(identity.workspaceId);
    return route.fulfill({ status: 412, json: { error: { code: "STALE_STATE", message: "Workspace changed. Review the current bill selection.", retryable: true, requestId: "synthetic-stale", currentVersion: 4 } } });
  });
  await page.goto("/app?view=CONTROL");
  await page.getByRole("button", { name: "Compare a bill", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Compare a bill" });
  await dialog.getByRole("radio", { name: "Zoho Books", exact: true }).check();
  const bill = dialog.getByRole("radio", { name: /SYNTHETIC-A2/ });
  await bill.check();
  await dialog.getByLabel("This entire bill is for this approved charge", { exact: true }).check();
  await dialog.getByLabel(/Keep this selected bill and comparison/).check();
  await dialog.getByRole("button", { name: "Save billed comparison" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Workspace changed");
  await expect(bill).not.toBeChecked();
  await bill.check();
  await expect(dialog.getByLabel("This entire bill is for this approved charge", { exact: true })).not.toBeChecked();
  await expect(dialog.getByLabel(/Keep this selected bill and comparison/)).not.toBeChecked();
  await expect(dialog.getByRole("button", { name: "Save billed comparison" })).toBeDisabled();
  expect(writes).toBe(1);
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith("vognary.control-provider-bill.")))).toEqual([]);
});

test("A2 exact money and controls reflow at short height, 320px and doubled text", async ({ page }, testInfo) => {
  expect((await page.request.post("/api/auth/login", { data: { email: process.env.VOGNARY_E2E_DEV_LOGIN_EMAIL, accessCode: process.env.VOGNARY_E2E_DEV_LOGIN_CODE } })).status()).toBe(200);
  const identity = (await (await page.request.get("/api/auth/session")).json()).session;
  const longName = "Synthetic exceptionally long supplier name for complete gross billed comparison";
  const money = "9007199254740993";
  const source = { condition: "CURRENT", latestSequence: "135", currentStatus: "READY", currentReviewRelevance: "BASELINE", freshness: a2CandidatePage.freshness, pendingMaterialNewerCount: 0, pendingMaterialNewerSequences: [], pendingMaterialOlderCount: 0, pendingMaterialOlderSequences: [], openFollowUpCount: 0, billReviewPath: "/app?view=BILL_REVIEW&bill=200001" };
  const proposal = { ...a2ComparisonResponse.proposal, merchant: longName, amountMinor: money, projectedThirteenWeekMinor: money, projectedAnnualMinor: money };
  const decision = { ...a2ComparisonResponse.decision, expectedAmountMinor: money, approvedCapMinor: money };
  const evaluation = { ...a2Evaluation, currencyResults: [{ ...a2Evaluation.currencyResults[0], proposedThirteenWeekMinor: money, combinedThirteenWeekMinor: money, proposedAnnualMinor: money, combinedAnnualMinor: money }] };
  let saved = false;
  await page.route("**/control/brief", route => route.fulfill({ json: { data: { policy: null,
    proposals: [{ proposal, evaluation, decision, reconciliations: saved ? [{ ...a2ComparisonResponse.reconciliation, expectedAmountMinor: money, approvedCapMinor: money, observedAmountMinor: money, providerBill: { ...a2ComparisonResponse.reconciliation.providerBill, workspaceId: identity.workspaceId, totalMinor: money, sourceTotal: "90071992547409.93", vendorName: longName }, providerBillSource: source }] : [], outcomeObservations: [], exceptionReviews: [] }],
    capabilities: { canSubmitProposal: true, canDecide: true, canConfigurePolicy: true } }, meta: { requestId: "synthetic-reflow", workspaceVersion: 3 } } }));
  await page.route("**/reconciliation-candidates?source=ZOHO_BOOKS*", route => route.fulfill({ json: { data: { ...a2CandidatePage, candidates: [{ ...a2CandidatePage.candidates[0], totalMinor: money, vendorName: longName }] }, meta: { requestId: "synthetic-reflow", workspaceVersion: 3 } } }));
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/app?view=CONTROL");
    if (viewport.width === 390) await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    await page.getByRole("button", { name: "Compare a bill", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Compare a bill" });
    await dialog.getByRole("radio", { name: "Zoho Books", exact: true }).check();
    await dialog.getByRole("radio", { name: /SYNTHETIC-A2/ }).check();
    await expect(dialog.getByRole("region", { name: "Billed comparison preview" }).getByText("INR 9,00,71,99,25,47,409.93", { exact: true })).toHaveCount(2);
    await dialog.getByLabel("This entire bill is for this approved charge", { exact: true }).check();
    await dialog.getByLabel(/Keep this selected bill and comparison/).check();
    const confirm = dialog.getByRole("button", { name: "Save billed comparison" });
    await confirm.scrollIntoViewIfNeeded();
    await expect(confirm).toBeInViewport();
    expect(await dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`picker-${viewport.width}x${viewport.height}.png`) });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  }
  saved = true;
  await page.goto(`/app?view=CONTROL&proposal=${a2Ids.proposal}&comparison=${a2Ids.comparison}`);
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  const result = page.getByRole("region", { name: "Saved billed comparison" });
  await expect(result.getByText("INR 9,00,71,99,25,47,409.93", { exact: true }).filter({ visible: true })).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect((await new AxeBuilder({ page }).include('[aria-label="Commitment records"]').analyze()).violations.filter(item => item.impact === "serious" || item.impact === "critical")).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("saved-doubled-text.png"), fullPage: true });
});

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
const localA2 = Boolean(process.env.DATABASE_URL && /^\/vognary_a2_\d+$/.test(new URL(process.env.DATABASE_URL).pathname)
  && new URL(process.env.DATABASE_URL).hostname === "127.0.0.1" && baseUrl === "http://127.0.0.1:57610");
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const reviewDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + 10 * 86400000));

function seed(action: string, directory: string, ...args: string[]) {
  expect(localA2).toBe(true);
  const output = execFileSync(process.execPath, ["--conditions=react-server", "--import=tsx", ".fallow/a2/frontend/seed.ts", action, directory, ...args], { encoding: "utf8", timeout: 30_000 });
  writeFileSync(join(directory, `command-${action}-${Date.now()}.log`), output);
}

async function installFixtureSession(context: BrowserContext, directory: string) {
  const cookie = JSON.parse(readFileSync(join(directory, "session.json"), "utf8"));
  await context.addCookies([{ name: cookie.name, value: cookie.value, url: baseUrl, httpOnly: true, sameSite: "Lax" }]);
}

async function createRealFixture(page: Page, testInfo: TestInfo) {
  const directory = testInfo.outputPath("synthetic-workspace");
  seed("create", directory);
  await installFixtureSession(page.context(), directory);
  const fixture = JSON.parse(readFileSync(join(directory, "fixture.json"), "utf8"));
  return { directory, workspaceId: fixture.workspaceId as string };
}

async function saveForm(page: Page, button: Locator, suffix: string) {
  await expect(button).toBeEnabled();
  const response = page.waitForResponse(value => new URL(value.url()).pathname.endsWith(suffix) && value.request().method() !== "GET");
  await button.click();
  const saved = await response;
  const payload = await saved.json();
  expect(saved.ok(), JSON.stringify(payload.error ?? {})).toBe(true);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  return payload;
}

async function authorizeRealCharge(page: Page) {
  await page.goto("/app?view=CONTROL");
  await page.getByRole("button", { name: "Set the policy", exact: true }).click();
  const policy = page.getByRole("dialog", { name: "Compose the next policy version" });
  for (const label of ["AI model", "Cloud infrastructure", "Software", "Contractor", "Campaign", "Other"]) await policy.getByLabel(label, { exact: true }).selectOption("ALLOW");
  await policy.getByLabel("Maximum per charge", { exact: true }).fill("200");
  await policy.getByLabel("Maximum 13-week exposure", { exact: true }).fill("1000");
  await policy.getByLabel("Maximum annual exposure", { exact: true }).fill("2000");
  await policy.getByRole("button", { name: "Review this policy", exact: true }).click();
  await saveForm(page, page.getByRole("dialog", { name: "Review before recording" }).getByRole("button", { name: "Record new version", exact: true }), "/control/policy");
  await page.getByLabel("Merchant or counterparty").fill("Synthetic A2 supplier");
  await page.getByLabel("Purpose", { exact: true }).fill("Synthetic whole-charge approval for browser verification");
  await page.getByLabel("Category", { exact: true }).selectOption("SOFTWARE");
  await page.getByLabel("Cadence", { exact: true }).selectOption("ONE_TIME");
  await page.getByLabel("Amount per charge", { exact: true }).fill("100");
  await page.getByLabel("First charge date").fill(today());
  const basis = page.getByLabel("This is the gross amount per charge, including tax, discounts and adjustments", { exact: true });
  await expect(basis).not.toBeChecked();
  await basis.check();
  await page.getByLabel("Metric", { exact: true }).fill("Synthetic completed tasks");
  await page.getByLabel("Target value", { exact: true }).fill("10");
  await page.getByLabel("Unit", { exact: true }).fill("tasks");
  await page.getByLabel("Review date", { exact: true }).fill(reviewDate());
  const proposal = await saveForm(page, page.getByRole("button", { name: "Evaluate proposal", exact: true }), "/control/proposals");
  expect(proposal.data.proposal.amountBasis).toBe("GROSS_BILLED_TOTAL_PER_CHARGE");
  expect(proposal.data.evaluation.amountBasis).toBe("GROSS_BILLED_TOTAL_PER_CHARGE");
  await page.getByRole("button", { name: "Decide this proposal", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Authorize this obligation" });
  await expect(dialog.getByText("Gross billed total per charge, including tax, discounts and adjustments", { exact: true })).toBeVisible();
  await dialog.getByRole("radio", { name: /Approve with cap/ }).check();
  await dialog.getByLabel("Approved cap per charge (INR)").fill("80");
  await dialog.getByLabel("Authorization expires on").fill(reviewDate());
  const decision = await saveForm(page, dialog.getByRole("button", { name: "Record decision", exact: true }), "/decision");
  expect(decision.data.decision.amountBasis).toBe("GROSS_BILLED_TOTAL_PER_CHARGE");
  expect(decision.data.decision.approvedCapMinor).toBe("8000");
  return { proposalId: proposal.data.proposal.id as string, decisionId: decision.data.decision.id as string };
}

async function selectRealBill(page: Page, paginate = false) {
  await page.getByRole("button", { name: "Compare a bill", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Compare a bill" });
  await dialog.getByRole("radio", { name: "Zoho Books", exact: true }).check();
  await expect(dialog.getByText("A recent complete import is available", { exact: true })).toBeVisible();
  if (paginate) {
    await expect(dialog.getByRole("radio", { name: /revision \d+/ })).toHaveCount(50);
    await dialog.getByRole("button", { name: "Next", exact: true }).click();
    await expect(dialog.getByRole("radio", { name: /revision \d+/ })).toHaveCount(50);
    await dialog.getByRole("button", { name: "Previous", exact: true }).click();
  }
  await dialog.getByLabel("Search supplier or bill number", { exact: true }).fill("SYNTHETIC-A2-CHARGE");
  await dialog.getByLabel("Bill currency", { exact: true }).fill("INR");
  await dialog.getByLabel("Sort bills", { exact: true }).selectOption("SUPPLIER");
  await expect(dialog.getByRole("button", { name: "Search bills", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Search bills", exact: true }).click();
  await expect(dialog.getByRole("radio", { name: /SYNTHETIC-A2-CHARGE/ })).toHaveCount(1);
  await dialog.getByRole("radio", { name: /SYNTHETIC-A2-CHARGE/ }).check();
  const preview = dialog.getByRole("region", { name: "Billed comparison preview" });
  await expect(preview.getByText("INR 80", { exact: true })).toBeVisible();
  await expect(preview.getByText("INR 90", { exact: true })).toBeVisible();
  await expect(preview.getByText("Bill is over the approved cap", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save billed comparison" })).toBeDisabled();
  await dialog.getByLabel("This entire bill is for this approved charge", { exact: true }).check();
  await expect(dialog.getByRole("button", { name: "Save billed comparison" })).toBeDisabled();
  await dialog.getByLabel(/Keep this selected bill and comparison/).check();
  return dialog;
}

test("A2 real owner authorizes, selects a fresh bill, returns and retains the original through amendment and source erasure", async ({ page, browser, context }, testInfo) => {
  test.skip(!localA2, "Requires the guarded loopback A2 database and ignored synthetic service helper");
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const fixture = await createRealFixture(page, testInfo);
  const authorized = await authorizeRealCharge(page);
  const empty = (await (await page.request.get(`/api/workspaces/current/control/proposals/${authorized.proposalId}/reconciliation-candidates?source=ZOHO_BOOKS`)).json()).data;
  expect(empty.candidates).toEqual([]);
  seed("import", fixture.directory);
  expect((await (await page.request.get("/api/workspaces/current/sources/zoho-books")).json()).data.configured).toBe(false);
  const writes: string[] = [];
  page.on("request", request => { if (request.method() === "POST" && request.url().endsWith("/reconciliations")) writes.push(request.postData()!); });
  const dialog = await selectRealBill(page, true);
  expect(writes).toEqual([]);
  await dialog.getByText("Source identity and observation times", { exact: true }).click();
  await expect(dialog.getByText(/Zoho Books India \/ organization 100001 \/ bill 908000001/)).toBeVisible();
  const axe = await new AxeBuilder({ page }).include("dialog").analyze();
  expect(axe.violations.filter(item => item.impact === "serious" || item.impact === "critical")).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("real-preview-no-writes.png"), fullPage: true });
  const response = await saveForm(page, dialog.getByRole("button", { name: "Save billed comparison", exact: true }), "/reconciliations");
  expect(writes).toHaveLength(1);
  expect(response.data.reconciliation.comparisonKind).toBe("BILLED_AMOUNT_COMPARISON");
  expect(response.data.reconciliation.outcome.verdict).toBe("NOT_OBSERVED");
  const comparisonId = response.data.reconciliation.id;
  const saved = page.getByRole("region", { name: "Saved billed comparison", exact: true });
  await expect(saved.getByText("INR 80", { exact: true })).toBeVisible();
  await expect(saved.getByText("INR 90", { exact: true })).toBeVisible();
  const copied = `/app?view=CONTROL&proposal=${authorized.proposalId}&comparison=${comparisonId}`;
  await expect(saved.getByRole("link", { name: "Open this comparison" })).toHaveAttribute("href", copied);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await saved.getByRole("button", { name: "Copy comparison link" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${baseUrl}${copied}`);
  await page.reload();
  await expect(saved.getByRole("heading", { name: "Saved billed comparison" })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("real-saved-return.png"), fullPage: true });
  const second = await browser.newContext({ baseURL: baseUrl, viewport: page.viewportSize() ?? undefined });
  try {
    seed("session", fixture.directory);
    await installFixtureSession(second, fixture.directory);
    const returned = await second.newPage();
    await returned.goto(copied);
    await expect(returned.getByRole("region", { name: "Saved billed comparison" }).getByText("INR 90", { exact: true })).toBeVisible();
  } finally { await second.close(); }
  seed("amend", fixture.directory, "95.00");
  await page.reload();
  await expect(saved.getByText(/1 newer material revision/)).toBeVisible();
  await expect(saved.getByText("INR 90", { exact: true })).toBeVisible();
  await saved.getByRole("link", { name: "Open bill review and remaining work" }).click();
  const disposition = page.getByRole("form", { name: "Bill disposition" });
  await disposition.getByRole("radio", { name: "Follow up", exact: true }).check();
  await disposition.getByLabel("Explanation", { exact: true }).fill("Synthetic amendment needs a separate human answer.");
  await disposition.getByLabel("Follow-up date", { exact: false }).fill(reviewDate());
  await disposition.getByRole("button", { name: "Save follow-up" }).click();
  await expect(page.getByRole("heading", { name: "Open follow-ups" })).toBeVisible();
  await page.goto(copied);
  await expect(saved.getByText(/1 open follow-up/)).toBeVisible();
  await expect(saved.getByText("INR 90", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("real-amendment-original-unchanged.png"), fullPage: true });
  seed("disconnect", fixture.directory);
  await page.goto("/app?view=ADD_EVIDENCE");
  await page.getByRole("region", { name: "Zoho Books" }).getByRole("button", { name: "Delete observations" }).click();
  const erase = page.getByRole("dialog", { name: "Delete Books observations" });
  await expect(erase.getByText(/^1 admitted bill record/)).toBeVisible();
  await expect(erase.getByRole("button", { name: "Delete observations" })).toBeDisabled();
  await erase.getByRole("checkbox", { name: /I understand/ }).check();
  await saveForm(page, erase.getByRole("button", { name: "Delete observations" }), "/sources/zoho-books");
  await page.goto(copied);
  await expect(saved.getByText(/Books imports were deleted/)).toBeVisible();
  await expect(saved.getByRole("link", { name: "Open bill review and remaining work" })).toHaveCount(0);
  await expect(saved.getByText("INR 80", { exact: true })).toBeVisible();
  await expect(saved.getByText("INR 90", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  const final = (await (await page.request.get("/api/workspaces/current/control/brief")).json()).data.proposals[0];
  expect(final.decision.approvedCapMinor).toBe("8000"); expect(final.reconciliations).toHaveLength(1);
  expect(final.reconciliations[0].id).toBe(comparisonId);
  expect(final.reconciliations[0].providerBillSource.condition).toBe("ERASED");
  writeFileSync(testInfo.outputPath("real-journey-proof.json"), JSON.stringify({ fixture: fixture.workspaceId, authorized, comparisonId, copied, writes: writes.map(value => JSON.parse(value)), final, errors }, null, 2));
  seed("inspect", fixture.directory);
  await page.screenshot({ path: testInfo.outputPath("real-retained-after-source-erasure.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("A2 real response loss after commit reloads and replays the original request after amendment and source erase", async ({ page }, testInfo) => {
  test.skip(!localA2, "Requires the guarded loopback A2 database and ignored synthetic service helper");
  test.setTimeout(180_000);
  const fixture = await createRealFixture(page, testInfo);
  const authorized = await authorizeRealCharge(page);
  seed("import", fixture.directory);
  const owner = (await (await page.request.get("/api/auth/session")).json()).session.userId;
  seed("admin-session", fixture.directory);
  await installFixtureSession(page.context(), fixture.directory);
  await page.goto(`/app?view=CONTROL&proposal=${authorized.proposalId}`);
  const admin = (await (await page.request.get("/api/auth/session")).json()).session.userId;
  expect(admin).not.toBe(owner);
  const dialog = await selectRealBill(page);
  let drop = true;
  const writes: { key: string; version: string; workspace: string; body: unknown; savedId: string }[] = [];
  await page.route("**/reconciliations", async route => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    const payload = await response.json();
    expect(response.ok(), JSON.stringify(payload.error ?? {})).toBe(true);
    const headers = route.request().headers();
    writes.push({ key: headers["idempotency-key"], version: headers["if-match"], workspace: headers["x-vognary-workspace"], body: route.request().postDataJSON(), savedId: payload.data.reconciliation.id });
    if (drop) return route.abort("failed");
    return route.fulfill({ response });
  });
  await dialog.getByRole("button", { name: "Save billed comparison" }).click();
  await expect(dialog.getByRole("alert")).toContainText(/cannot confirm/);
  expect(writes).toHaveLength(2);
  expect(writes[0]).toEqual(writes[1]);
  seed("amend", fixture.directory, "95.00");
  seed("erase", fixture.directory);
  await page.reload();
  await page.getByRole("button", { name: "Check original billed comparison" }).click();
  await expect(dialog.getByRole("button", { name: "Retry original comparison" })).toBeEnabled();
  await expect(dialog.getByRole("radio", { name: "Saved receipts", exact: true })).toBeDisabled();
  drop = false;
  await dialog.getByRole("button", { name: "Retry original comparison" }).click();
  await expect(dialog).toHaveCount(0);
  expect(writes).toHaveLength(3);
  expect(writes[2]).toEqual(writes[0]);
  const saved = page.getByRole("region", { name: "Saved billed comparison" });
  await expect(saved.getByText(/Books imports were deleted/)).toBeVisible();
  await expect(saved.getByText("INR 90", { exact: true })).toBeVisible();
  await expect(saved.getByText("INR 95", { exact: true })).toHaveCount(0);
  const final = (await (await page.request.get("/api/workspaces/current/control/brief")).json()).data.proposals[0];
  expect(final.proposal.id).toBe(authorized.proposalId);
  expect(final.reconciliations).toHaveLength(1);
  expect(final.reconciliations[0].id).toBe(writes[0].savedId);
  expect(final.decision.decidedByUserId).toBe(owner);
  expect(final.reconciliations[0].reconciledByUserId).toBe(admin);
  expect(final.reconciliations[0].providerBill.consentAuthorizedByUserId).toBe(owner);
  expect(final.reconciliations[0].providerBill.selectedByUserId).toBe(admin);
  expect(final.decision.approvedCapMinor).toBe("8000");
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith("vognary.control-provider-bill.")))).toEqual([]);
  writeFileSync(testInfo.outputPath("real-lost-response-proof.json"), JSON.stringify({ fixture: fixture.workspaceId, writes, final }, null, 2));
  seed("inspect", fixture.directory);
  await page.screenshot({ path: testInfo.outputPath("real-original-replay-after-source-erasure.png"), fullPage: true });
});



