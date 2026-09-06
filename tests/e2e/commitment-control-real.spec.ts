import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { evidencePath } from "./evidence";

const email = process.env.VOGNARY_E2E_DEV_LOGIN_EMAIL;
const accessCode = process.env.VOGNARY_E2E_DEV_LOGIN_CODE;
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
const disposable = process.env.VOGNARY_E2E_CONTROL_DISPOSABLE === "true";
const merchant = "Synthetic Control Vendor";
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
test.skip(!email || !accessCode || !disposable, "requires an explicitly disposable Control workspace and development login");

test("a finance owner completes the real Control loop, returns, exports and erases it", async ({ page, browser }, testInfo) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(15_000);
  expect(["127.0.0.1", "localhost", "[::1]"]).toContain(new URL(baseUrl).hostname);
  expect(email).toMatch(/@[^@]+\.test$/);
  const runtimeErrors: string[] = [];
  page.on("pageerror", error => runtimeErrors.push(error.message));

  await signIn(page);
  await deleteAccount(page);
  await signIn(page);
  await selectView(page, "Decisions");
  await expect(page.getByRole("button", { name: "Set the policy", exact: true })).toBeInViewport();
  await expect(page.getByLabel("Merchant or counterparty")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Evaluate proposal", exact: true })).toHaveCount(0);
  await page.screenshot({ path: evidencePath(`control-real-setup-${testInfo.project.name}.png`), fullPage: true });

  await page.getByRole("button", { name: "Set the policy", exact: true }).click();
  const policyDialog = page.getByRole("dialog", { name: "Compose the next policy version" });
  for (const label of ["AI model", "Cloud infrastructure", "Software", "Contractor", "Campaign", "Other"]) {
    await policyDialog.getByLabel(label, { exact: true }).selectOption("ALLOW");
  }
  if (await policyDialog.getByLabel("Maximum per charge", { exact: true }).count() === 0) {
    await policyDialog.getByLabel("Add a currency").selectOption("INR");
  }
  await policyDialog.getByLabel("Maximum per charge", { exact: true }).fill("200");
  await policyDialog.getByLabel("Maximum 13-week exposure", { exact: true }).fill("1000");
  await policyDialog.getByLabel("Maximum annual exposure", { exact: true }).fill("2000");
  await policyDialog.getByRole("button", { name: "Review this policy", exact: true }).click();
  await submit(page, page.getByRole("button", { name: "Record new version", exact: true }), "/control/policy");
  await expect(page.getByLabel("Merchant or counterparty")).toBeVisible();

  await page.getByLabel("Merchant or counterparty").fill(merchant);
  await page.getByLabel("Purpose", { exact: true }).fill("Synthetic control acceptance journey");
  await page.getByLabel("Category", { exact: true }).selectOption("AI_MODEL");
  await page.getByLabel("Cadence", { exact: true }).selectOption("ONE_TIME");
  await page.getByLabel("Amount per charge", { exact: true }).fill("100");
  await page.getByLabel("Currency", { exact: true }).selectOption("INR");
  await page.getByLabel("First charge date").fill(today);
  await page.getByLabel("Metric", { exact: true }).fill("Synthetic completed tasks");
  await page.getByLabel("Target direction", { exact: true }).selectOption("AT_LEAST");
  await page.getByLabel("Target value", { exact: true }).fill("10");
  await page.getByLabel("Unit", { exact: true }).fill("tasks");
  await page.getByLabel("Review date", { exact: true }).fill(today);
  await submit(page, page.getByRole("button", { name: "Evaluate proposal", exact: true }), "/control/proposals");
  const record = page.getByRole("article", { name: merchant, exact: true });
  await expect(record.getByText("User-entered assumption", { exact: true })).toBeVisible();
  await expect(record.getByText("Human decision required", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Merchant or counterparty")).toBeHidden();

  await record.getByRole("button", { name: "Decide this proposal", exact: true }).click();
  const decisionDialog = page.getByRole("dialog", { name: "Authorize this obligation" });
  await decisionDialog.getByRole("radio", { name: /Approve with cap/ }).check();
  await decisionDialog.getByLabel("Approved cap per charge (INR)").fill("80");
  await decisionDialog.getByLabel("Authorization expires on").fill(today);
  await submit(page, decisionDialog.getByRole("button", { name: "Record decision", exact: true }), "/decision");
  await expect(record.getByText("INR 80", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Merchant or counterparty")).toBeHidden();

  await selectView(page, "Evidence");
  await page.getByRole("button", { name: "Add a bill", exact: true }).first().click();
  const receiptDialog = page.getByRole("dialog", { name: "Add a bill" });
  await receiptDialog.getByRole("tab", { name: "Paste text" }).click();
  await receiptDialog.getByLabel("Receipt or invoice text").fill(
    `Vendor: ${merchant}; invoice paid INR 90.00 on ${today}. One-time purchase.`,
  );
  const receiptResponse = await submit(page, receiptDialog.getByRole("button", { name: "Add a bill", exact: true }), "/evidence");
  expect(receiptResponse.data.submission.acceptedEvidenceCount).toBe(1);

  await selectView(page, "Decisions");
  await record.getByRole("button", { name: "Link observed evidence", exact: true }).click();
  const reconcileDialog = page.getByRole("dialog", { name: "Link observed evidence" });
  await reconcileDialog.getByRole("button", { name: "Review this saved bill", exact: true }).first().click();
  await expect(reconcileDialog.getByRole("button", { name: "Link this receipt", exact: true })).toBeDisabled();
  await reconcileDialog.getByRole("radio").first().check();
  await reconcileDialog.getByLabel("Observed value (tasks)").fill("9");
  await reconcileDialog.getByLabel("Observed on").fill(today);
  await submit(page, reconcileDialog.getByRole("button", { name: "Link this receipt", exact: true }), "/reconciliations");
  await expectReconciledRecord(record);
  await expect(page.getByLabel("Merchant or counterparty")).toBeHidden();
  await expectReadableMetadata(record);
  await expectAccessible(page);
  await page.screenshot({ path: evidencePath(`control-real-reconciled-${testInfo.project.name}.png`), fullPage: true });

  await page.getByRole("button", { name: "Record disposition", exact: true }).first().click();
  const reviewDialog = page.getByRole("dialog", { name: "Record the exception disposition" });
  await reviewDialog.getByRole("radio", { name: "A new proposal is required", exact: true }).check();
  await reviewDialog.getByLabel("Why this disposition was chosen").fill("Synthetic overage requires a separate human authorization.");
  await submit(page, reviewDialog.getByRole("button", { name: "Record disposition", exact: true }), "/exception-reviews");
  await expect(record.getByText("New proposal required", { exact: true })).toBeVisible();
  await expectReconciledRecord(record);
  await page.reload();
  await selectView(page, "Decisions");
  await expectReconciledRecord(record);

  const secondContext = await browser.newContext({ baseURL: baseUrl, viewport: page.viewportSize() ?? undefined });
  try {
    const returnedPage = await secondContext.newPage();
    await signIn(returnedPage);
    await selectView(returnedPage, "Decisions");
    await expectReconciledRecord(returnedPage.getByRole("article", { name: merchant, exact: true }));

    await page.goto("/profile");
    await page.getByText("Privacy", { exact: true }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download my data", exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("vognary-privacy-export.json");
    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();
    const document = JSON.parse(await readFile(downloadPath!, "utf8"));
    expect(document.commitmentControl.proposals).toHaveLength(1);
    expect(document.commitmentControl.decisions).toHaveLength(1);
    expect(document.commitmentControl.decisions[0].approvedCapMinor).toBe("8000");
    expect(document.commitmentControl.reconciliations).toHaveLength(1);
    expect(document.commitmentControl.reconciliations[0].verdict).toBe("OVER_CAP");
    expect(document.commitmentControl.reconciliations[0].observedAmountMinor).toBe("9000");
    expect(document.commitmentControl.exceptionReviews).toHaveLength(1);
    expect(JSON.stringify(document)).not.toContain(accessCode!);

    await deleteAccount(page);
    await returnedPage.goto("/app");
    await expect(returnedPage).toHaveURL(/\/login/);
  } finally {
    await secondContext.close();
  }
  expect(runtimeErrors).toEqual([]);
});

async function signIn(page: Page) {
  const identity = randomBytes(12).toString("hex").match(/.{4}/g)!.join(":");
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `2001:db8:${identity}` });
  await page.goto(`${baseUrl}/login?next=/app`);
  await page.getByText("Other ways to sign in").click();
  await page.getByLabel("Configured developer email").fill(email!);
  await page.getByLabel("Development access code").fill(accessCode!);
  const loginResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/auth/login" && response.request().method() === "POST");
  const navigation = page.waitForURL(url => url.pathname === "/app", { waitUntil: "load" });
  await page.getByRole("button", { name: "Sign in as developer", exact: true }).click();
  expect((await loginResponse).status()).toBe(200);
  await navigation;
  await expect(page.getByRole("heading", { level: 1, name: "Vognary" })).toBeVisible();
}

async function deleteAccount(page: Page) {
  await page.goto(`${baseUrl}/profile#delete-account`);
  await page.getByText("Danger Zone", { exact: true }).click();
  await page.getByLabel(/Type DELETE MY VOGNARY DATA to confirm/).fill("DELETE MY VOGNARY DATA");
  await page.getByRole("button", { name: "Delete server data", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your Vognary account was deleted" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("status")).toContainText(/Deleted 1 workspace\(s\) and signed out/);
}

async function selectView(page: Page, name: "Decisions" | "Evidence") {
  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name, exact: true }).click();
}

async function submit(page: Page, button: Locator, suffix: string) {
  const responsePromise = page.waitForResponse(response =>
    new URL(response.url()).pathname.endsWith(suffix) && response.request().method() !== "GET",
  { timeout: 60_000 });
  await button.click();
  const response = await responsePromise;
  const payload = await response.json();
  expect(response.ok(), `${suffix}: ${JSON.stringify(payload.error ?? {})}`).toBe(true);
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 30_000 });
  return payload;
}

async function expectReconciledRecord(record: Locator) {
  await expect(record.getByText("INR 80", { exact: true })).toBeVisible();
  await expect(record.getByText("INR 90", { exact: true })).toBeVisible();
  await expect(record.getByText("Over the frozen cap", { exact: true })).toBeVisible();
  await expect(record.getByText("Outcome missed", { exact: true })).toBeVisible();
  await expect(record.getByText(/User-entered outcome observation.*not Recovery evidence/)).toBeVisible();
}

async function expectReadableMetadata(record: Locator) {
  const rectangles = await record.locator(".ledger-verdict > .control-card-meta").evaluateAll(elements => elements.map(element => {
    const bounds = element.getBoundingClientRect();
    return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom };
  }));
  expect(rectangles).toHaveLength(2);
  expect(rectangles[0].bottom <= rectangles[1].top || rectangles[1].bottom <= rectangles[0].top
    || rectangles[0].right <= rectangles[1].left || rectangles[1].right <= rectangles[0].left).toBe(true);
}

async function expectAccessible(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter(violation => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}
