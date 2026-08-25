import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { HomeProjectionDto } from "../../src/lib/recovery/contracts";

/**
 * Recovery v1 — honest states, evidence submission, and the profile surface.
 * Same harness as recovery-ui-home.spec.ts: a real development-login session for
 * the server-rendered shell, mocked contract payloads for everything else.
 */

const email = process.env.VOGNARY_E2E_DEV_LOGIN_EMAIL;
const accessCode = process.env.VOGNARY_E2E_DEV_LOGIN_CODE;
const receiptInboxE2e = process.env.VOGNARY_E2E_RECEIPT_INBOX === "true";

test.skip(!email || !accessCode, "development login env not configured");

const meta = { requestId: "request-e2e", workspaceVersion: 4 };

const emptyHome: HomeProjectionDto = {
  workspace: { id: "workspace-1", name: "Founder workspace", role: "owner", version: 4 },
  generatedAt: "2026-08-09T10:00:00.000Z",
  recentObservations: [],
  monthlyTotals: [],
  annualizedEstimateTotals: [],
  next30DayTotals: [],
  confidenceLayers: [],
  needsMe: [],
  changed: { state: "NO_PRIOR_BASELINE", fromVersion: null, toVersion: 4, items: [] },
  next: [],
  coverage: {
    state: "NO_EVIDENCE",
    sourceCount: 0,
    evidenceCount: 0,
    lastEvidenceAt: null,
    coverageStart: null,
    coverageEnd: null,
    limitations: ["No evidence has been submitted."],
  },
  activeCommitmentCount: 0,
  unknownCadenceCommitmentCount: 0,
  uncertainDuplicateCommitmentCount: 0,
  reviewItemCount: 0,
  possibleOverlaps: [],
  evidenceSources: [],
  decisionQueue: [],
  decisionOutcomes: [],
  nextQuietCharge: null,
};

const oneObservationHome: HomeProjectionDto = {
  ...emptyHome,
  recentObservations: [{
    evidenceId: "evidence-once-1",
    merchant: "Figma",
    amount: { currency: "INR", minor: "149900", exponent: 2, display: "₹1,499.00" },
    date: "2026-08-09",
  }],
  coverage: {
    state: "BASELINE_ONLY",
    sourceCount: 1,
    evidenceCount: 1,
    lastEvidenceAt: "2026-08-09T10:00:00.000Z",
    coverageStart: "2026-08-09",
    coverageEnd: "2026-08-09",
    limitations: ["One receipt has been checked; no repeated service is proven."],
  },
};

async function signIn(page: Page) {
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 180) + 50}` });
  await page.goto("/login");
  await page.getByText("Other ways to sign in").click();
  await page.getByPlaceholder("developer@example.com").fill(email!);
  await page.getByPlaceholder("Access code").fill(accessCode!);
  await page.getByRole("button", { name: "Sign in as developer" }).click();
  await page.waitForURL(/\/app/);
}

async function mockEmptyWorkspace(page: Page, home = emptyHome) {
  const activationCalls: string[] = [];
  await page.route("**/api/workspaces/current/activation", (route) => {
    activationCalls.push(route.request().method());
    return route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ data: { recorded: false, id: null }, meta }),
    });
  });
  await page.route("**/api/workspaces/current/brief", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: home, meta }) }),
  );
  await page.route("**/api/workspaces/current/commitments**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { items: [], total: 0, nextCursor: null }, meta }) }),
  );
  await page.route("**/api/workspaces/current/evidence/evidence-once-1", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          id: "evidence-once-1",
          source: {
            id: "source-1",
            type: "RECEIPT_PASTE",
            label: "Pasted receipt",
            ingestedAt: "2026-08-09T10:00:00.000Z",
            coverageStart: "2026-08-09",
            coverageEnd: "2026-08-09",
          },
          immutable: true,
          observedAt: "2026-08-09T00:00:00.000Z",
          excerpt: "Figma invoice paid INR 1,499.00 on 9 August 2026.",
          excerptTruncated: false,
          amount: { currency: "INR", minor: "149900", exponent: 2, display: "₹1,499.00" },
          date: "2026-08-09",
          provenance: { kind: "USER_SUBMITTED", reference: "submission-1:source-1:1" },
          confidence: { state: "LOW", score: 55, scale: "PERCENT_0_100", reasons: ["One saved observation."] },
        },
        meta,
      }),
    }),
  );
  return { activationCalls };
}

async function openAddBills(page: Page) {
  await page.getByRole("button", { name: "Add a bill" }).first().click();
  const overlay = page.getByRole("dialog", { name: "Add a bill" });
  await expect(overlay).toBeVisible();
  await overlay.getByRole("tab", { name: "Paste text" }).click();
  return overlay;
}

test("an empty workspace offers exactly one obvious add-bills action", async ({ page }) => {
  await signIn(page);
  const { activationCalls } = await mockEmptyWorkspace(page);
  await page.goto("/app");

  await expect(page.getByRole("heading", { name: "Start with a software bill." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add a bill" })).toBeVisible();
  await expect(page.getByText("No mailbox access required.")).toBeVisible();
  const overlay = await openAddBills(page);
  await expect(overlay.getByRole("heading", { name: "Add a bill" })).toBeVisible();
  await expect(overlay.getByLabel("Receipt or invoice text")).toBeVisible();
  await expect(overlay.getByRole("button", { name: "Add a bill" })).toBeDisabled();
  await expect(overlay.getByText(/connect|Gmail|bank account/i)).toHaveCount(0);
  expect(activationCalls).toEqual([]);
});

test("one observed charge asks for a matching receipt instead of rendering an all-clear", async ({ page }) => {
  await signIn(page);
  const { activationCalls } = await mockEmptyWorkspace(page, oneObservationHome);
  await page.goto("/app");

  const observed = page.getByRole("region", { name: "Not enough history yet" });
  await expect(observed.getByRole("heading", { name: "Not enough history yet" })).toBeVisible();
  await expect(observed.getByText("We saved 1 bill.")).toBeVisible();
  await expect(observed.getByText("Figma", { exact: true })).toBeVisible();
  await expect(observed.getByText("₹1,499.00", { exact: true })).toBeVisible();
  await expect(page.getByText("Nothing needs attention right now")).toHaveCount(0);
  await expect(observed.getByRole("button", { name: "Add a bill" })).toBeVisible();
  await expectNoSeriousAxeViolations(page, "one-observation Home");

  await observed.getByRole("button", { name: "Add a bill" }).click();
  await expect(page.getByRole("dialog", { name: "Add a bill" })).toBeVisible();
  expect(activationCalls).toEqual([]);
});

test("receipt onboarding shows proven forwarding, backfill, and sender trust", async ({ page }) => {
  test.skip(!receiptInboxE2e, "receipt inbox E2E environment not configured");
  await signIn(page);
  await mockEmptyWorkspace(page, oneObservationHome);
  await page.route("**/api/workspaces/current/sources", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      data: {
        state: "READY",
        alias: {
          id: "11111111-1111-4111-8111-111111111111",
          status: "ACTIVE",
          address: "rcpt_0123456789abcdef0123456789abcdef01234567@receipts.vognary.test",
          createdAt: "2026-08-10T10:00:00.000Z",
          rotatedAt: null,
          revokedAt: null,
        },
        lastReceivedAt: "2026-08-10T10:05:00.000Z",
        lastProcessedAt: "2026-08-10T10:06:00.000Z",
        lastFailureCode: null,
        setupCompletedAt: "2026-08-10T10:06:00.000Z",
        forwardingVerifiedAt: "2026-08-10T10:06:00.000Z",
        backfillCompletedAt: "2026-08-10T10:06:00.000Z",
        gmailVerification: null,
      },
      meta,
    }),
  }));
  await page.route("**/api/workspaces/current/evidence/evidence-once-1", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      data: {
        id: "evidence-once-1",
        source: {
          id: "source-1",
          type: "FORWARDED_EMAIL",
          label: "Forwarded receipt",
          ingestedAt: "2026-08-10T10:06:00.000Z",
          coverageStart: "2026-08-09",
          coverageEnd: "2026-08-09",
        },
        immutable: true,
        observedAt: "2026-08-09T00:00:00.000Z",
        excerpt: "Figma invoice paid INR 1,499.00 on 9 August 2026.",
        excerptTruncated: false,
        amount: { currency: "INR", minor: "149900", exponent: 2, display: "₹1,499.00" },
        date: "2026-08-09",
        provenance: { kind: "PROVIDER_RECEIVED", reference: "submission-1:source-1:1" },
        senderTrust: {
          tier: "VERIFIED_SENDER",
          fromDomain: "figma.com",
          trustedAuthority: "amazonses.com",
          reasons: ["amazonses.com reported aligned mail authentication for figma.com."],
        },
        confidence: { state: "LOW", score: 55, scale: "PERCENT_0_100", reasons: ["One saved observation."] },
      },
      meta,
    }),
  }));

  await page.goto("/app");
  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Receipts" }).click();
  await expect(page.getByRole("heading", { name: "Stay up to date" })).toBeVisible();
  await expect(page.getByText("Status: On")).toBeVisible();
  await page.getByText("Older bills", { exact: true }).click();
  await expect(page.getByRole("link", { name: "Google's forwarding instructions" })).toHaveAttribute("href", /answer\/10957/);
  await expect(page.getByRole("link", { name: "Google's filter instructions" })).toHaveAttribute("href", /answer\/6579/);
  await expect(page.getByRole("link", { name: "Google's attachment instructions" })).toHaveAttribute("href", /answer\/9261412/);
  await expectNoSeriousAxeViolations(page, "receipt onboarding");

  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Now" }).click();
  await expect(page.getByRole("heading", { name: "Not enough history yet" })).toBeVisible();
});

async function expectNoSeriousAxeViolations(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).analyze();
  const serious = result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  expect(serious, `${label}:\n${serious.map((violation) => `${violation.id}: ${violation.help}`).join("\n")}`).toEqual([]);
}

test("submitted evidence reports accepted, invalid, unreadable, and duplicate results honestly", async ({ page }) => {
  await signIn(page);
  await mockEmptyWorkspace(page);
  await page.route("**/api/workspaces/current/evidence", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          submission: {
            id: "submission-1",
            type: "RECEIPT_PASTE",
            ingestedAt: "2026-08-09T10:00:00.000Z",
            acceptedEvidenceCount: 1,
            results: [
              { clientRef: "receipt-paste-1", status: "ACCEPTED", code: null, message: null },
              { clientRef: "receipt-paste-2", status: "REJECTED", code: "PARSE_FAILED", message: "No merchant, amount, and date were found." },
              { clientRef: "receipt-paste-3", status: "REJECTED", code: "DUPLICATE_EVIDENCE", message: "This receipt is already stored." },
              { clientRef: "receipt-paste-4", status: "REJECTED", code: "INVALID_EVIDENCE", message: "This text is not a receipt." },
            ],
          },
          home: emptyHome,
          commitments: [],
          commitmentTotal: 0,
        },
        meta: { requestId: "request-evidence", workspaceVersion: 5 },
      }),
    }),
  );
  await page.goto("/app");
  const overlay = await openAddBills(page);

  await overlay.getByLabel("Receipt or invoice text").fill("OpenAI invoice paid INR 1,999 on 2026-07-06. Renews monthly.");
  await overlay.getByRole("button", { name: "Add a bill" }).click();

  const receipt = overlay.getByRole("region", { name: "What happened" });
  await expect(receipt).toBeVisible();
  await expect(receipt.getByText("1 bill was saved.")).toBeVisible();
  await expect(receipt.getByText("We couldn't read this invoice.")).toBeVisible();
  await expect(receipt.getByText("Already added")).toBeVisible();
  await expect(receipt.getByText("This invoice couldn't be read.")).toBeVisible();
  await expect(overlay.getByLabel("Receipt or invoice text")).toHaveValue(/OpenAI invoice/);
});

test("an unreachable saved workspace is stated plainly and never faked", async ({ page }) => {
  await signIn(page);
  await page.route("**/api/workspaces/current/brief", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "DATABASE_UNAVAILABLE", message: "The saved workspace could not be reached.", retryable: true, requestId: "request-db" } }),
    }),
  );
  await page.route("**/api/workspaces/current/commitments**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { items: [], nextCursor: null }, meta }) }),
  );
  await page.goto("/app");

  await expect(page.getByText("Saved workspace unavailable")).toBeVisible();
  await expect(page.getByText("Your saved workspace could not be reached. Nothing was changed.")).toBeVisible();
  await page.getByText("Technical details").click();
  await expect(page.getByText(/reference request-db/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByText("₹")).toHaveCount(0);
});

test("a signed-out session shows the sign-in state instead of an empty ledger", async ({ page }) => {
  await signIn(page);
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ authenticated: false, configuration: { status: "ready", cookieName: "vognary_session" }, session: null }),
    }),
  );
  await page.goto("/app");

  await expect(page.getByText("This workspace is not open on this device")).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in to continue" })).toHaveAttribute("href", "/login?next=/app");
});

test("going offline is stated before any action is attempted", async ({ page }) => {
  await signIn(page);
  await mockEmptyWorkspace(page);
  await page.goto("/app");
  await openAddBills(page);

  await page.context().setOffline(true);
  await expect(page.getByText("This device is offline")).toBeVisible();
  await expect(page.getByText("Offline — nothing can be sent right now.")).toBeVisible();
  await page.context().setOffline(false);
  await expect(page.getByText("This device is offline")).toHaveCount(0);
});

test("account access leaves Recovery for the canonical profile route", async ({ page }) => {
  await signIn(page);
  await mockEmptyWorkspace(page);
  await page.goto("/app");

  const account = page.getByRole("link", { name: `Account for ${email}` });
  await expect(account).toHaveAttribute("href", "/profile");
  await account.focus();
  await expect(account).toBeFocused();
  await account.press("Enter");
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByRole("heading", { level: 1, name: "Account Settings" })).toBeVisible();
});

test("empty Home and the add-bills overlay fit a 390px phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await mockEmptyWorkspace(page);
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Start with a software bill." })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.getByRole("button", { name: "Add a bill" }).click();
  const overlay = page.getByRole("dialog", { name: "Add a bill" });
  await expect(overlay.getByText("Drop bills or receipts here")).toBeVisible();
  await overlay.getByRole("tab", { name: "Paste text" }).click();
  await expect(overlay.getByLabel("Receipt or invoice text")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await expectNoSeriousAxeViolations(page, "390px empty Home overlay");
});

test("Gmail wizard step 1 fits a 390px phone", async ({ page }) => {
  test.skip(!receiptInboxE2e, "receipt inbox E2E environment not configured");
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await mockEmptyWorkspace(page);
  await page.route("**/api/workspaces/current/sources", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      data: {
        state: "WAITING",
        alias: {
          id: "11111111-1111-4111-8111-111111111111",
          status: "ACTIVE",
          address: "rcpt_0123456789abcdef0123456789abcdef01234567@receipts.vognary.test",
          createdAt: "2026-08-10T10:00:00.000Z",
          rotatedAt: null,
          revokedAt: null,
        },
        lastReceivedAt: null,
        lastProcessedAt: null,
        lastFailureCode: null,
        setupCompletedAt: null,
        forwardingVerifiedAt: null,
        backfillCompletedAt: null,
        gmailVerification: null,
      },
      meta,
    }),
  }));
  await page.goto("/app");
  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Receipts" }).click();
  await expect(page.getByRole("heading", { name: "Stay up to date" })).toBeVisible();
  await page.getByRole("button", { name: "Continue setup" }).click();
  await expect(page.getByRole("heading", { name: "Verify your private Vognary address" })).toBeVisible();
  await expect(page.getByText("Step 1 of 3")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await expectNoSeriousAxeViolations(page, "390px Gmail wizard step 1");
});
