import { randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Recovery v1 workspace — mocked-contract UI journey.
 *
 * The signed-in `/app` shell is rendered by the server from a real session
 * cookie, so this suite needs the development login. Every Recovery API route is
 * then mocked with fixed contract payloads, so the assertions below are about the
 * UI rendering server truth exactly — never about the backend's own maths.
 *
 *   PLAYWRIGHT_EXTERNAL_SERVER=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 \
 *   VOGNARY_E2E_DEV_LOGIN_EMAIL=founder@vognary.test \
 *   VOGNARY_E2E_DEV_LOGIN_CODE=local-dev-code-123 \
 *   npm run test:e2e -- recovery-ui-home
 */

const email = process.env.VOGNARY_E2E_DEV_LOGIN_EMAIL;
const accessCode = process.env.VOGNARY_E2E_DEV_LOGIN_CODE;

test.skip(!email || !accessCode, "development login env not configured");

const money = { currency: "INR", minor: "199900", exponent: 2, display: "₹1,999.00" };
const raisedMoney = { currency: "INR", minor: "209900", exponent: 2, display: "₹2,099.00" };
const confidence = { state: "MEDIUM", score: 72, scale: "PERCENT_0_100", reasons: ["One user-submitted receipt"] };

const source = {
  id: "source-1",
  type: "RECEIPT_PASTE",
  label: "Pasted receipt",
  ingestedAt: "2026-08-09T10:00:00.000Z",
  coverageStart: "2026-07-06",
  coverageEnd: "2026-07-06",
};

const evidence = {
  id: "evidence-1",
  source,
  immutable: true,
  observedAt: "2026-07-06T00:00:00.000Z",
  excerpt: "OpenAI invoice paid INR 1,999. Renews monthly.",
  excerptTruncated: false,
  amount: money,
  date: "2026-07-06",
  provenance: { kind: "USER_SUBMITTED", reference: "submission-1:1" },
  confidence,
};

const commitment = {
  id: "commitment-1",
  version: 1,
  status: "ACTIVE",
  merchant: "OpenAI",
  category: "AI tools",
  cadence: "MONTHLY",
  amount: money,
  monthlyEquivalent: money,
  nextExpectedDate: "2026-08-06",
  confidence,
  recommendedDecision: "MONITOR",
  decision: null,
  evidenceCount: 1,
  updatedAt: "2026-08-09T10:00:00.000Z",
};

const detail = {
  ...commitment,
  recommendationReason: "Confirm this with a second receipt.",
  riskTags: ["single occurrence"],
  evidence: { items: [evidence], total: 1, nextCursor: null },
  corrections: [
    {
      id: "correction-1",
      commitmentId: "commitment-1",
      patch: { field: "MERCHANT", value: { merchant: "OpenAI" } },
      authoritativeAmount: null,
      reason: "The invoice spells it this way.",
      status: "ACTIVE",
      createdAt: "2026-08-09T10:00:00.000Z",
      reversedAt: null,
      supersededAt: null,
    },
  ],
  expectation: {
    status: "INSUFFICIENT_HISTORY",
    expectedDate: null,
    expectedAmount: null,
    observedDate: null,
    observedAmount: null,
    windowStart: null,
    windowEnd: null,
    summary: "There is not enough settled rhythm yet to compare an expected charge with what arrived.",
    reasons: [],
  },
  memory: [],
  belief: null,
  because: [],
  context: null,
  overlap: null,
  decisionHistory: [],
};

const home = {
  workspace: { id: "workspace-1", name: "Founder workspace", role: "owner", version: 4 },
  generatedAt: "2026-08-09T10:00:00.000Z",
  monthlyTotals: [{ amount: money, commitmentIds: ["commitment-1"], evidenceIds: ["evidence-1"], provenance: "RECEIPT", correctionIds: [] }],
  annualizedEstimateTotals: [{
    amount: { currency: "INR", minor: "2398800", exponent: 2, display: "₹23,988.00" },
    commitmentIds: ["commitment-1"],
    evidenceIds: ["evidence-1"],
    provenance: "RECEIPT",
    correctionIds: [],
  }],
  next30DayTotals: [{ amount: money, commitmentIds: ["commitment-1"], evidenceIds: ["evidence-1"], provenance: "RECEIPT", correctionIds: [] }],
  confidenceLayers: [],
  needsMe: [
    {
      id: "attention-1",
      commitmentId: "commitment-1",
      priority: "MEDIUM",
      reason: "LOW_CONFIDENCE",
      title: "Confirm OpenAI",
      detail: "Only one receipt supports this commitment.",
      amount: money,
      dueDate: "2026-08-06",
      evidenceIds: ["evidence-1"],
    },
  ],
  changed: { state: "NO_PRIOR_BASELINE", fromVersion: null, toVersion: 4, items: [] },
  next: [
    {
      commitmentId: "commitment-github",
      merchant: "GitHub",
      date: "2026-09-30",
      daysAway: 52,
      amount: money,
      decision: { value: "KEEP", decidedAt: "2026-08-08T10:00:00.000Z", updatedAt: "2026-08-08T10:00:00.000Z" },
      confidence,
      reminderEligible: true,
      evidenceIds: ["evidence-github-1"],
    },
  ],
  coverage: {
    state: "BASELINE_ONLY",
    sourceCount: 1,
    evidenceCount: 1,
    lastEvidenceAt: "2026-07-06T00:00:00.000Z",
    coverageStart: "2026-07-06",
    coverageEnd: "2026-07-06",
    limitations: ["Only pasted receipts are covered."],
  },
  recentObservations: [],
  activeCommitmentCount: 1,
  unknownCadenceCommitmentCount: 0,
  uncertainDuplicateCommitmentCount: 0,
  reviewItemCount: 1,
  possibleOverlaps: [],
  evidenceSources: [],
  decisionQueue: [{
    commitmentId: "commitment-1",
    merchant: "OpenAI",
    dueDate: "2026-08-06",
    daysAway: 3,
    charge: money,
    stake: { currency: "INR", minor: "2398800", exponent: 2, display: "₹23,988.00" },
    headline: "Decide before Thursday",
    sentence: "OpenAI charges ₹1,999.00. Charges in 3 days. You have not decided this cycle.",
    excerpt: "OpenAI invoice paid INR 1,999. Renews monthly.",
    citedEvidenceId: "evidence-1",
    provisional: false,
    reasonKeys: ["RENEWS_SOON"],
    reasons: ["Expected in 3 days."],
    overlapMerchants: [],
    askPurpose: false,
    evidenceIds: ["evidence-1"],
  }],
  decisionOutcomes: [],
  nextQuietCharge: null,
};

const meta = { requestId: "request-e2e", workspaceVersion: 4 };

type DecisionOutcome = { ok: true } | { ok: false; status: number; body: unknown };

const emptyAttention = {
  attention: [],
  coverage: { coverageBroken: false, automaticSourceCount: 0, limitations: [] },
  sources: [],
  commitments: [],
};

async function mockRecoveryApi(page: Page, options: { decision?: DecisionOutcome } = {}) {
  let currentDetail: Record<string, unknown> = detail;
  let currentMeta = meta;
  const activationResponses: number[] = [];
  page.on("response", (response) => {
    const request = response.request();
    if (request.method() === "POST" && new URL(response.url()).pathname === "/api/workspaces/current/activation") {
      activationResponses.push(response.status());
    }
  });
  await page.route("**/api/workspaces/current/brief", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: home, meta }) }),
  );
  await page.route("**/api/workspaces/current/recovery-attention", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: emptyAttention, meta: currentMeta }) }),
  );
  await page.route("**/api/workspaces/current/activation", (route) => {
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ data: { recorded: true, id: "event-1", outcome: "recorded" }, meta: currentMeta }),
    });
  });
  await page.route("**/api/workspaces/current/evidence/*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: evidence, meta: currentMeta }) }),
  );
  await page.route("**/api/workspaces/current/commitments**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = path.endsWith("/commitments")
      ? { data: { items: [commitment], total: 1, nextCursor: null }, meta: currentMeta }
      : { data: currentDetail, meta: currentMeta };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.route("**/api/workspaces/current/decisions", (route) => {
    const outcome = options.decision ?? { ok: true as const };
    if (!outcome.ok) {
      return route.fulfill({ status: outcome.status, contentType: "application/json", body: JSON.stringify(outcome.body) });
    }
    const savedDecision = { value: "CANCEL", decidedAt: "2026-08-09T12:00:00.000Z", updatedAt: "2026-08-09T12:00:00.000Z" };
    currentMeta = { requestId: "request-decision", workspaceVersion: 5 };
    currentDetail = { ...detail, decision: savedDecision };
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          decision: savedDecision,
          commitment: { ...commitment, decision: savedDecision },
          home,
        },
        meta: { requestId: "request-decision", workspaceVersion: 5 },
      }),
    });
  });
  return { activationResponses };
}

async function signIn(page: Page) {
  const identity = randomBytes(12).toString("hex").match(/.{4}/g)!.join(":");
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `2001:db8:${identity}` });
  await page.route("**/api/workspaces/current/control/brief", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ error: { code: "FEATURE_UNAVAILABLE", message: "not enrolled", retryable: false, requestId: "recovery-home-control-gate" } }),
  }));
  await page.goto("/login");
  await page.getByText("Other ways to sign in").click();
  await page.getByPlaceholder("developer@example.com").fill(email!);
  await page.getByPlaceholder("Access code").fill(accessCode!);
  const loginResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/auth/login" && response.request().method() === "POST");
  await page.getByRole("button", { name: "Sign in as developer" }).click();
  expect((await loginResponse).status()).toBe(200);
  await page.waitForURL(/\/app/);
}

test("home renders attention, upcoming charges, and receipt freshness without inventing changes", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as typeof window & { __vognaryCopiedText?: string }).__vognaryCopiedText = text;
        },
      },
    });
  });
  await signIn(page);
  const { activationResponses } = await mockRecoveryApi(page);
  await page.goto("/app");

  await expect(page.getByRole("heading", { level: 1, name: "Vognary" })).toBeVisible();
  await expect(page.getByText("Saved to Vognary")).toHaveText("Saved to Vognary");

  const nav = page.getByRole("navigation", { name: "Primary" });
  for (const label of ["Today", "Decisions", "Bills", "Evidence"]) {
    await expect(nav.getByRole("button", { name: label })).toBeVisible();
  }
  await expect(nav.getByRole("button", { name: "Automation" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: `Account for ${email}` })).toHaveAttribute("href", "/profile");
  const addBill = page.locator("#workspace-add-bill");
  await expect(addBill).toBeVisible();
  await addBill.click();
  await expect(page.getByRole("dialog", { name: "Add a bill" })).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(page.getByRole("heading", { name: "Decide now" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Next charges" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What we found" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Receipts checked" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Since your last visit" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Currently committed" })).toHaveCount(0);

  await expect.poll(() => activationResponses.length).toBe(1);
  expect(activationResponses).toEqual([201]);
  await expect(page.getByRole("heading", { name: "OpenAI" })).toBeVisible();
  await expect(page.getByText("₹1,999.00").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /Charges in 3 days/ })).toBeVisible();
  await expect(page.getByText("Decide before Thursday")).toBeVisible();
  await expect(page.getByText("OpenAI invoice paid INR 1,999. Renews monthly.")).toBeVisible();
  await expect(page.getByRole("button", { name: "See the cited receipt" })).toBeVisible();
  await expect(page.getByText("Why now")).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep", exact: true })).toBeVisible();
  await expect(page.getByText("Annualized estimate", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Copy summary" })).toHaveCount(0);

  await expect(page.getByText(/connect|sync your bank|Gmail/i)).toHaveCount(0);
});

test("later evidence produces a genuine changed list instead of a baseline", async ({ page }) => {
  await signIn(page);
  const comparedHome = {
    ...home,
    workspace: { ...home.workspace, version: 5 },
    changed: {
      state: "COMPARED",
      fromVersion: 4,
      toVersion: 5,
      items: [
        {
          id: "change-1",
          commitmentId: "commitment-1",
          merchant: "OpenAI",
          kind: "AMOUNT",
          before: money,
          after: raisedMoney,
          detectedAt: "2026-08-09T10:05:00.000Z",
          provenance: { kind: "EVIDENCE", submissionId: "submission-2", evidenceIds: ["evidence-2"] },
        },
      ],
    },
  };
  await page.route("**/api/workspaces/current/brief", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: comparedHome, meta: { requestId: "request-compared", workspaceVersion: 5 } }) }),
  );
  await page.route("**/api/workspaces/current/commitments**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { items: [commitment], total: 1, nextCursor: null }, meta: { requestId: "request-compared-list", workspaceVersion: 5 } }) }),
  );
  await page.goto("/app");

  await expect(page.getByRole("heading", { name: "What changed" })).toBeVisible();
  const changedBox = await page.getByRole("heading", { name: "What changed" }).boundingBox();
  const decisionsBox = await page.getByRole("heading", { name: "Decide now" }).boundingBox();
  expect(decisionsBox?.y).toBeLessThan(changedBox?.y ?? 0);
  await expect(page.getByText("Amount changed")).toBeVisible();
  await expect(page.getByText("OpenAI").first()).toBeVisible();
  await expect(page.getByText("Your subscriptions look the same")).toHaveCount(0);
});

test("a commitment exposes its exact evidence and returns focus after inspection", async ({ page }) => {
  await signIn(page);
  await mockRecoveryApi(page);
  await page.goto("/app");

  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Bills" }).click();
  await page.getByRole("button", { name: /OpenAI/ }).first().click();

  await expect(page.getByRole("heading", { name: "OpenAI" })).toBeVisible();
  await expect(page.getByText("OpenAI invoice paid INR 1,999. Renews monthly.", { exact: false })).toBeVisible();

  const inspect = page.getByRole("button", { name: "See the receipt" }).first();
  await inspect.click();

  const dialog = page.getByRole("dialog", { name: "The receipt" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Observed fact (exact excerpt)")).toBeVisible();
  await expect(dialog.getByText("Pasted receipt", { exact: true }).first()).toBeVisible();
  await expect(dialog.getByText("6 Jul 2026").first()).toBeVisible();
  await expect(dialog.getByText("INR", { exact: true }).first()).toBeVisible();
  await expect(dialog.getByText(/smallest unit/)).toHaveCount(0);
  await expect(dialog.getByText(/unpublished/)).toHaveCount(0);
  await expect(dialog.getByText(/legacy-evidence/)).toHaveCount(0);
  await expect(dialog.getByText("You added this")).toBeVisible();
  await expect(dialog.getByText("Likely", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Treat the amount and date as an estimate until another bill arrives.")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(inspect).toBeFocused();
});

test("Now keeps the three primary choices; Bills routes decisions back to Now", async ({ page }) => {
  await signIn(page);
  await mockRecoveryApi(page);
  await page.goto("/app");

  const nowChoices = page.getByRole("group", { name: "Your choice" });
  for (const label of ["Keep", "Plan to cancel", "Review later"]) {
    await expect(nowChoices.getByRole("button", { name: new RegExp(`^${label}`) })).toBeVisible();
  }

  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Bills" }).click();
  await page.getByRole("button", { name: /OpenAI/ }).first().click();
  await expect(page.getByRole("group", { name: "Your choice" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Decide on Now" })).toBeVisible();

  await page.getByRole("button", { name: "Decide on Now" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Today" })).toBeVisible();
  await expect(nowChoices.getByRole("button", { name: /^Plan to cancel/ })).toBeVisible();

  await nowChoices.getByRole("button", { name: /^Plan to cancel/ }).click();
  await expect(page.getByRole("heading", { name: "OpenAI — plan to cancel is recorded" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Saved. OpenAI is now Plan to cancel.");
  await expect(page.getByText("Saved to Vognary")).toHaveText("Saved to Vognary");
});

test("a rejected decision rolls back visibly and states what the workspace still holds", async ({ page }) => {
  await signIn(page);
  await mockRecoveryApi(page, {
    decision: {
      ok: false,
      status: 502,
      body: { error: { code: "SAVE_FAILED", message: "The change did not save.", retryable: true, requestId: "request-rollback" } },
    },
  });
  await page.goto("/app");

  await page.getByRole("group", { name: "Your choice" }).getByRole("button", { name: /^Plan to cancel/ }).click();

  const alert = page.getByRole("alert").filter({ hasText: "Rolled back" });
  await expect(alert).toBeVisible();
  await expect(alert.getByText(/“Plan to cancel” for OpenAI was not saved/)).toBeVisible();
  await expect(alert.getByText(/still without a recorded decision/)).toBeVisible();
  await expect(alert.getByText(/request-rollback/)).toBeVisible();
});

test("correcting a commitment offers every contract field and shows reversible history", async ({ page }) => {
  await signIn(page);
  await mockRecoveryApi(page);
  await page.goto("/app");

  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Bills" }).click();
  await page.getByRole("button", { name: /OpenAI/ }).first().click();

  await page.getByText("Something wrong?").click();
  for (const label of ["Correct merchant", "Correct amount", "Correct expected date", "Correct how often", "Correct recurring or not"]) {
    await expect(page.getByRole("button", { name: label })).toBeVisible();
  }
  await expect(page.getByText("Merchant set to “OpenAI”")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reverse this correction" })).toBeVisible();

  const trigger = page.getByRole("button", { name: "Correct amount" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Correct amount" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Enter the amount a founder would read on the receipt/)).toBeVisible();
  await expect(dialog.getByText(/smallest unit/)).toHaveCount(0);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(trigger).toBeFocused();
});

test("the workspace stays usable and keyboard-reachable on a 390px phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await mockRecoveryApi(page);
  await page.goto("/app");

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);

  const commitmentsTab = page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Bills" });
  await expect(commitmentsTab).toBeEnabled();
  await commitmentsTab.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 2, name: "Bills" })).toBeFocused();
});

test("Mandate stays hidden until notice delivery is proven", async ({ page }) => {
  await signIn(page);
  await mockRecoveryApi(page);
  await page.goto("/app");

  await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Automation" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "I accept this standing mandate" })).toHaveCount(0);
});

test("existing authority is isolated to Automation while Now stays decision-led", async ({ page }) => {
  const autopilotHome = {
    ...home,
    autopilot: {
      executionEnabled: false,
      noticeEnabled: false,
      noticeReadiness: {
        featureSwitch: false,
        channelReady: false,
        credentialsPresent: false,
        webhookReady: false,
        deliveryProven: false,
        state: "off",
      },
      mandate: {
        id: "mandate-1",
        version: 1,
        status: "ACTIVE",
        termsVersion: "standing-mandate-v1",
        signedText: "Standing mandate terms for the e2e fixture.",
        signedTextHash: "a".repeat(64),
        currency: "INR",
        perActionCeilingMinor: "500000",
        rolling30dCeilingMinor: "2000000",
        vetoWindowHours: 48,
        signedAt: "2026-08-09T10:00:00.000Z",
        revokedAt: null,
      },
      watching: [],
      awaitingDelivery: [],
      inVeto: [],
      handled: [],
      needsHelp: [],
      proof: [{ candidateId: "candidate-1", status: "PENDING", expectedDebitDate: "2026-09-06", currency: "USD", saving: null }],
      fees: [],
      attempts: [],
    },
  };
  await signIn(page);
  await mockRecoveryApi(page);
  await page.route("**/api/workspaces/current/brief", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: autopilotHome, meta }) }),
  );
  await page.goto("/app");

  const automation = await openOverflowDestination(page, "Automation");
  await expect(page.getByRole("heading", { name: "This workspace has an active standing mandate" })).toHaveCount(0);
  await expect(page.getByText("Exception-only home")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Today" })).toBeVisible();
  await automation.click();
  await expect(page.getByText("This workspace has an active standing mandate", { exact: true })).toBeVisible();
  await expect(page.getByText("Off — no cancellation is executed")).toBeVisible();
  await expect(page.getByText("Standing mandate terms for the e2e fixture.")).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });

  const desktopAxe = await new AxeBuilder({ page }).analyze();
  expect(desktopAxe.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);

  await page.setViewportSize({ width: 375, height: 812 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
  const mobileAxe = await new AxeBuilder({ page }).analyze();
  expect(mobileAxe.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);
});

test("an active mandate does not restore the retired spend strip on Now", async ({ page }) => {
  const autopilotHome = {
    ...home,
    monthlyTotals: [],
    annualizedEstimateTotals: [],
    next30DayTotals: [],
    activeCommitmentCount: 0,
    unknownCadenceCommitmentCount: 0,
  uncertainDuplicateCommitmentCount: 0,
    reviewItemCount: 0,
    autopilot: {
      executionEnabled: false,
      noticeEnabled: false,
      noticeReadiness: {
        featureSwitch: false,
        channelReady: false,
        credentialsPresent: false,
        webhookReady: false,
        deliveryProven: false,
        state: "off",
      },
      mandate: {
        id: "mandate-1",
        version: 1,
        status: "ACTIVE",
        termsVersion: "standing-mandate-v1",
        signedText: "Standing mandate terms for the e2e fixture.",
        signedTextHash: "a".repeat(64),
        currency: "INR",
        perActionCeilingMinor: "500000",
        rolling30dCeilingMinor: "2000000",
        vetoWindowHours: 48,
        signedAt: "2026-08-09T10:00:00.000Z",
        revokedAt: null,
      },
      watching: [],
      awaitingDelivery: [],
      inVeto: [],
      handled: [],
      needsHelp: [],
      proof: [],
      fees: [],
      attempts: [],
    },
  };
  await signIn(page);
  await mockRecoveryApi(page);
  await page.route("**/api/workspaces/current/brief", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: autopilotHome, meta }) }),
  );
  await page.goto("/app");

  await expect(page.getByText("Exception-only home")).toHaveCount(0);
  await openOverflowDestination(page, "Automation");
  await expect(page.getByText("Software commitments")).toHaveCount(0);
  await expect(page.getByText("No recurring amount yet")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Next charges" })).toBeVisible();
});

test("Home posts activation only after a cited recurring-spend picture actually renders", async ({ page }) => {
  const emptyHome = {
    ...home,
    monthlyTotals: [],
    annualizedEstimateTotals: [],
    next30DayTotals: [],
    needsMe: [],
    next: [],
    recentObservations: [],
    activeCommitmentCount: 0,
    unknownCadenceCommitmentCount: 0,
  uncertainDuplicateCommitmentCount: 0,
    reviewItemCount: 0,
    coverage: {
      state: "NO_EVIDENCE",
      sourceCount: 0,
      evidenceCount: 0,
      lastEvidenceAt: null,
      coverageStart: null,
      coverageEnd: null,
      limitations: ["No evidence has been submitted."],
    },
  };
  const activationCalls: string[] = [];
  await page.route("**/api/workspaces/current/activation", (route) => {
    activationCalls.push(route.request().method());
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ data: { recorded: true, id: "event-1", outcome: "recorded" }, meta }),
    });
  });
  await page.route("**/api/workspaces/current/brief", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: emptyHome, meta }) }),
  );
  await page.route("**/api/workspaces/current/commitments**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { items: [], total: 0, nextCursor: null }, meta }) }),
  );

  await signIn(page);
  await expect(page.getByRole("heading", { level: 2, name: "Today" })).toBeVisible();
  await expect(page.getByText("Software commitments")).toHaveCount(0);
  expect(activationCalls).toEqual([]);

  await page.goto("about:blank");
  await page.route("**/api/workspaces/current/brief", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: home, meta }) }),
  );
  await page.route("**/api/workspaces/current/commitments**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = path.endsWith("/commitments")
      ? { data: { items: [commitment], total: 1, nextCursor: null }, meta }
      : { data: detail, meta };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Decide now" })).toBeVisible();
  await expect.poll(() => activationCalls.length).toBe(1);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Decide now" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(activationCalls).toHaveLength(1);
});

test("Home records activation after analytics opt-in on a tab that previously received 202", async ({ page }) => {
  let consented = false;
  const activationCalls: Array<{ status: number }> = [];
  await page.route("**/api/workspaces/current/activation", (route) => {
    const status = consented ? 201 : 202;
    activationCalls.push({ status });
    return route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify({
        data: consented
          ? { recorded: true, id: "event-1", outcome: "recorded" }
          : { recorded: false, id: null, outcome: "deferred-no-consent" },
        meta,
      }),
    });
  });
  await page.route("**/api/workspaces/current/brief", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: home, meta }) }),
  );
  await page.route("**/api/workspaces/current/commitments**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = path.endsWith("/commitments")
      ? { data: { items: [commitment], total: 1, nextCursor: null }, meta }
      : { data: detail, meta };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  await signIn(page);
  await expect(page.getByRole("heading", { name: "Decide now" })).toBeVisible();
  await expect.poll(() => activationCalls.length).toBe(1);
  expect(activationCalls[0]).toEqual({ status: 202 });
  expect(await page.evaluate((key) => sessionStorage.getItem(key), `vognary.workspace-activation.settled:${home.workspace.id}`)).toBeNull();

  consented = true;
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Decide now" })).toBeVisible();
  await expect.poll(() => activationCalls.length).toBe(2);
  expect(activationCalls[1]).toEqual({ status: 201 });
  expect(await page.evaluate((key) => sessionStorage.getItem(key), `vognary.workspace-activation.settled:${home.workspace.id}`)).toBe("1");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Decide now" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(activationCalls).toHaveLength(2);
});

test("Home records activation after a 401 once the tab can authenticate again", async ({ page }) => {
  let authenticated = false;
  const activationCalls: Array<{ status: number }> = [];
  await page.route("**/api/workspaces/current/activation", (route) => {
    if (!authenticated) {
      activationCalls.push({ status: 401 });
      return route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "AUTH_REQUIRED", message: "Sign in to continue.", retryable: false, requestId: "request-e2e" },
        }),
      });
    }
    activationCalls.push({ status: 201 });
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ data: { recorded: true, id: "event-1", outcome: "recorded" }, meta }),
    });
  });
  await page.route("**/api/workspaces/current/brief", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: home, meta }) }),
  );
  await page.route("**/api/workspaces/current/commitments**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = path.endsWith("/commitments")
      ? { data: { items: [commitment], total: 1, nextCursor: null }, meta }
      : { data: detail, meta };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  await signIn(page);
  await expect(page.getByRole("heading", { name: "Decide now" })).toBeVisible();
  await expect.poll(() => activationCalls.length).toBe(1);
  expect(activationCalls[0]).toEqual({ status: 401 });
  expect(await page.evaluate((key) => sessionStorage.getItem(key), `vognary.workspace-activation.settled:${home.workspace.id}`)).toBeNull();

  authenticated = true;
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Decide now" })).toBeVisible();
  await expect.poll(() => activationCalls.length).toBe(2);
  expect(activationCalls[1]).toEqual({ status: 201 });

  await page.reload();
  await expect(page.getByRole("heading", { name: "Decide now" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(activationCalls).toHaveLength(2);
});

const queuedCandidate = {
  id: "candidate-queued",
  commitmentId: "commitment-1",
  merchant: "OpenAI",
  eligibility: "ELIGIBLE",
  status: "NOTICE_QUEUED",
  reasons: [],
  providerId: "openai",
  amount: money,
  noticeDeliveredAt: null,
  vetoDeadlineAt: null,
  noticeDeliveryStatus: "QUEUED",
  tokenCoverageInvalid: false,
  noticePresentation: { kind: "queued" as const },
  exceptionCode: null,
};

const deliveredCandidate = {
  ...queuedCandidate,
  id: "candidate-delivered",
  merchant: "Notion",
  noticeDeliveredAt: "2026-08-24T00:05:00.000Z",
  vetoDeadlineAt: "2026-08-26T00:05:00.000Z",
  noticeDeliveryStatus: "DELIVERED",
  noticePresentation: {
    kind: "veto-window" as const,
    deliveredAt: "2026-08-24T00:05:00.000Z",
    vetoDeadlineAt: "2026-08-26T00:05:00.000Z",
  },
};

const bouncedCandidate = {
  ...queuedCandidate,
  id: "candidate-bounced",
  merchant: "Figma",
  status: "EXCEPTION",
  noticeDeliveryStatus: "BOUNCED",
  noticePresentation: { kind: "bounced" as const },
};

test("unproven notice delivery stays off Now and fails closed in Automation", async ({ page }) => {
  const usdSaving = { currency: "USD", minor: "1000", exponent: 2, display: "$10.00" };
  const inrSaving = { currency: "INR", minor: "199900", exponent: 2, display: "₹1,999.00" };
  const noticeHome = {
    ...home,
    autopilot: {
      executionEnabled: false,
      noticeEnabled: true,
      noticeReadiness: {
        featureSwitch: true,
        channelReady: true,
        credentialsPresent: true,
        webhookReady: true,
        deliveryProven: false,
        state: "configured-unproven",
      },
      mandate: {
        id: "mandate-1",
        version: 1,
        status: "ACTIVE",
        termsVersion: "standing-mandate-2026-08-16",
        signedText: "I authorize Vognary. Authority is limited to INR ₹50,000 per action and INR ₹2,00,000 rolling 30-day ceiling.",
        signedTextHash: "a".repeat(64),
        currency: "INR",
        perActionCeilingMinor: "5000000",
        rolling30dCeilingMinor: "20000000",
        vetoWindowHours: 48,
        signedAt: "2026-08-09T10:00:00.000Z",
        revokedAt: null,
      },
      watching: [],
      awaitingDelivery: [queuedCandidate],
      inVeto: [deliveredCandidate],
      handled: [],
      needsHelp: [bouncedCandidate],
      proof: [
        { candidateId: "candidate-delivered", status: "COVERED_CLEAN", expectedDebitDate: "2026-09-06", currency: "INR", saving: inrSaving },
        { candidateId: "candidate-usd", status: "COVERED_CLEAN", expectedDebitDate: "2026-09-07", currency: "USD", saving: usdSaving },
      ],
      fees: [{
        currency: "INR",
        monitoring: { currency: "INR", minor: "19900", exponent: 2, display: "₹199.00" },
        verifiedSaving: inrSaving,
        outcomeFee: { currency: "INR", minor: "0", exponent: 2, display: "₹0.00" },
        retained: { currency: "INR", minor: "0", exponent: 2, display: "₹0.00" },
        refundCredit: { currency: "INR", minor: "0", exponent: 2, display: "₹0.00" },
        additionalCharge: { currency: "INR", minor: "0", exponent: 2, display: "₹0.00" },
        chargeStatus: "FAIL_CLOSED",
      }],
      attempts: [],
    },
  };
  await signIn(page);
  await mockRecoveryApi(page);
  await page.route("**/api/workspaces/current/brief", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: noticeHome, meta }) }),
  );
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Delivery pending" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "48-hour veto window" })).toHaveCount(0);
  const automation = await openOverflowDestination(page, "Automation");
  await automation.click();
  await expect(page.getByText("Configured, but live delivery is not proven")).toBeVisible();
  await expect(page.getByText("Off — no cancellation is executed")).toBeVisible();
  await expect(page.getByText(/Figma: EXCEPTION/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Veto", exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByText("Configured, but live delivery is not proven")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
});

test("Sources tab disconnects cited Recovery sources without rotating the receipt alias", async ({ page }) => {
  const sourcedHome = {
    ...home,
    evidenceSources: [{
      id: "source-1",
      kind: "RECEIPT_PASTE",
      label: "Pasted OpenAI receipt",
      cited: true,
      status: "CONNECTED" as const,
      disconnectedAt: null,
      reconnectedAt: null,
    }],
  };
  await signIn(page);
  await mockRecoveryApi(page);
  await page.route("**/api/workspaces/current/brief", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: sourcedHome, meta }) }),
  );
  const disconnectCalls: string[] = [];
  await page.route("**/api/workspaces/current/autopilot/sources/*/disconnect", (route) => {
    disconnectCalls.push(route.request().method());
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          sourceId: "source-1",
          disconnectedAt: "2026-08-16T00:00:00.000Z",
          reconnectedAt: null,
          withdrawnCandidateIds: ["candidate-queued"],
        },
        meta: { requestId: "request-disconnect", workspaceVersion: 5 },
      }),
    });
  });
  const reconnectCalls: string[] = [];
  await page.route("**/api/workspaces/current/autopilot/sources/*/reconnect", (route) => {
    reconnectCalls.push(route.request().method());
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          sourceId: "source-1",
          disconnectedAt: "2026-08-16T00:00:00.000Z",
          reconnectedAt: "2026-08-16T00:05:00.000Z",
          withdrawnCandidateIds: [],
        },
        meta: { requestId: "request-reconnect", workspaceVersion: 6 },
      }),
    });
  });
  await page.goto("/app");
  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Evidence" }).click();
  await page.getByText("Advanced").click();
  await expect(page.getByText("Pasted OpenAI receipt")).toBeVisible();
  await expect(page.getByText("Pasted bill · Connected")).toBeVisible();
  await page.getByRole("button", { name: "Disconnect source" }).click();
  await expect.poll(() => disconnectCalls).toEqual(["POST"]);

  await page.route("**/api/workspaces/current/brief", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          ...sourcedHome,
          evidenceSources: [{
            ...sourcedHome.evidenceSources[0],
            status: "DISCONNECTED",
            cited: false,
            disconnectedAt: "2026-08-16T00:00:00.000Z",
          }],
        },
        meta,
      }),
    }),
  );
  await page.reload();
  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Evidence" }).click();
  await page.getByText("Advanced").click();
  await expect(page.getByText("Pasted bill · Disconnected")).toBeVisible();
  await page.getByRole("button", { name: "Reconnect source" }).click();
  await expect.poll(() => reconnectCalls).toEqual(["POST"]);
});

/** Automation is the fifth destination, so the phone bar keeps it behind More. */
async function openOverflowDestination(page: Page, label: string) {
  const nav = page.getByRole("navigation", { name: "Primary" });
  await nav.getByRole("group").filter({ hasText: "More" }).first().click();
  const destination = nav.getByRole("button", { name: label });
  await expect(destination).toBeVisible();
  return destination;
}
