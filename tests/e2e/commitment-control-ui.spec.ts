import { expect, test, type Page, type Request } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { evidencePath } from "./evidence";

/**
 * Commitment Control V0 — mocked-contract UI journey.
 *
 * The signed-in `/app` shell is rendered from a real session cookie, so this
 * suite needs the development login. Every workspace API route is then mocked
 * with fixed contract payloads, so the assertions below are about the UI
 * rendering server truth exactly — never about the backend's own maths.
 *
 *   PLAYWRIGHT_EXTERNAL_SERVER=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 \
 *   VOGNARY_E2E_DEV_LOGIN_EMAIL=founder@vognary.test \
 *   VOGNARY_E2E_DEV_LOGIN_CODE=local-dev-code-123 \
 *   npm run test:e2e -- commitment-control-ui
 */

const email = process.env.VOGNARY_E2E_DEV_LOGIN_EMAIL;
const accessCode = process.env.VOGNARY_E2E_DEV_LOGIN_CODE;

const controlToday = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

test.skip(!email || !accessCode, "development login env not configured");

const money = { currency: "INR", minor: "199900", exponent: 2, display: "₹1,999.00" };
const confidence = { state: "MEDIUM", score: 72, scale: "PERCENT_0_100", reasons: ["One user-submitted receipt"] };

const commitment = {
  id: "11111111-1111-4111-8111-111111111111",
  version: 1,
  status: "ACTIVE",
  merchant: "OpenAI",
  category: "AI tools",
  cadence: "MONTHLY",
  amount: money,
  monthlyEquivalent: money,
  nextExpectedDate: "2026-09-06",
  confidence,
  recommendedDecision: "MONITOR",
  decision: null,
  evidenceCount: 1,
  updatedAt: "2026-08-09T10:00:00.000Z",
};

const merchantTextMatchCommitment = {
  ...commitment,
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  merchant: "Anthropic",
};

const evidenceId = "22222222-2222-4222-8222-222222222222";

const evidence = {
  id: evidenceId,
  source: {
    id: "source-1",
    type: "RECEIPT_PASTE",
    label: "Pasted receipt",
    ingestedAt: "2026-08-09T10:00:00.000Z",
    coverageStart: "2026-07-06",
    coverageEnd: "2026-07-06",
  },
  immutable: true,
  observedAt: "2026-08-26T00:00:00.000Z",
  excerpt: "Anthropic invoice paid INR 51,000.00 on 26 Aug 2026.",
  excerptTruncated: false,
  amount: { currency: "INR", minor: "5100000", exponent: 2, display: "₹51,000.00" },
  date: "2026-08-26",
  provenance: { kind: "USER_SUBMITTED", reference: "submission-1:1" },
  confidence,
};

const detail = {
  ...commitment,
  recommendationReason: "Confirm this with a second receipt.",
  riskTags: [],
  evidence: { items: [evidence], total: 1, nextCursor: null },
  corrections: [],
  expectation: {
    status: "INSUFFICIENT_HISTORY",
    expectedDate: null,
    expectedAmount: null,
    observedDate: null,
    observedAmount: null,
    windowStart: null,
    windowEnd: null,
    summary: "There is not enough settled rhythm yet.",
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
  generatedAt: "2026-08-25T10:00:00.000Z",
  monthlyTotals: [],
  annualizedEstimateTotals: [],
  next30DayTotals: [],
  confidenceLayers: [],
  needsMe: [],
  changed: { state: "NO_PRIOR_BASELINE", fromVersion: null, toVersion: 4, items: [] },
  next: [],
  coverage: {
    state: "BASELINE_ONLY",
    sourceCount: 1,
    evidenceCount: 1,
    lastEvidenceAt: "2026-08-26T00:00:00.000Z",
    coverageStart: "2026-07-06",
    coverageEnd: "2026-08-26",
    limitations: [],
  },
  recentObservations: [],
  activeCommitmentCount: 1,
  unknownCadenceCommitmentCount: 0,
  uncertainDuplicateCommitmentCount: 0,
  reviewItemCount: 0,
  possibleOverlaps: [],
  evidenceSources: [],
  decisionQueue: [{
    commitmentId: commitment.id,
    merchant: "OpenAI",
    dueDate: "2026-09-06",
    daysAway: 12,
    charge: money,
    stake: { currency: "INR", minor: "2398800", exponent: 2, display: "₹23,988.00" },
    headline: "Decide before Sunday",
    sentence: "OpenAI charges ₹1,999.00. Charges in 12 days. You have not decided this cycle.",
    excerpt: "OpenAI invoice paid INR 1,999. Renews monthly.",
    citedEvidenceId: evidenceId,
    provisional: false,
    reasonKeys: ["RENEWS_SOON"],
    reasons: ["Expected in 12 days."],
    overlapMerchants: [],
    askPurpose: false,
    evidenceIds: [evidenceId],
  }],
  decisionOutcomes: [],
  nextQuietCharge: null,
};

const meta = { requestId: "request-e2e", workspaceVersion: 4 };

const policy = {
  policyVersion: 3,
  categoryRules: [
    { category: "AI_MODEL", posture: "REVIEW" },
    { category: "SOFTWARE", posture: "ALLOW" },
    { category: "CAMPAIGN", posture: "OUTSIDE_POLICY" },
  ],
  currencyLimits: [{ currency: "INR", maxPerChargeMinor: "2000000", maxThirteenWeekMinor: "6000000", maxAnnualMinor: "24000000" }],
  createdByUserId: "33333333-3333-4333-8333-333333333333",
  createdAt: "2026-08-20T09:00:00.000Z",
};

const proposalId = "44444444-4444-4444-8444-444444444444";
const evaluationId = "55555555-5555-4555-8555-555555555555";
const decisionId = "66666666-6666-4666-8666-666666666666";

const proposal = {
  id: proposalId,
  submittedByUserId: "33333333-3333-4333-8333-333333333333",
  submittedByDisplayName: "Founder",
  merchant: "Anthropic",
  purpose: "Claude API for the product loop",
  category: "AI_MODEL",
  amountMinor: "4500000",
  currency: "INR",
  firstChargeDate: controlToday,
  cadence: "MONTHLY",
  asOfDate: "2026-08-25",
  projectedThirteenWeekMinor: "13500000",
  projectedAnnualMinor: "54000000",
  intendedOutcome: {
    metric: "Resolved support cases",
    targetDirection: "AT_LEAST",
    targetValue: "1200",
    unit: "cases",
    reviewOn: controlToday,
  },
  assumptionBasis: "USER_ENTERED_ASSUMPTION",
  createdAt: "2026-08-25T09:00:00.000Z",
};

const currencyResult = {
  currency: "INR",
  existingThirteenWeekMinor: "599700",
  proposedThirteenWeekMinor: "13500000",
  combinedThirteenWeekMinor: "14099700",
  thirteenWeekHeadroomMinor: "0",
  existingAnnualMinor: "2398800",
  proposedAnnualMinor: "54000000",
  combinedAnnualMinor: "56398800",
  annualHeadroomMinor: "0",
};

const evaluation = {
  id: evaluationId,
  proposalId,
  policyVersion: 3,
  status: "OUTSIDE_POLICY",
  humanDecisionRequired: true,
  assumptionFields: ["amountMinor", "currency", "category", "thirteenWeekMinor", "annualMinor"],
  citedEvidenceIds: [evidenceId],
  citedExposureBasis: "PROJECTED",
  reasonCodes: ["CATEGORY_REQUIRES_REVIEW", "PER_CHARGE_LIMIT_EXCEEDED"],
  currencyResults: [currencyResult],
  evaluatedAt: "2026-08-25T09:00:00.000Z",
};

const decision = {
  id: decisionId,
  evaluationId,
  proposalId,
  evaluationPolicyVersion: 3,
  action: "APPROVE_WITH_CAP",
  approvedCapMinor: "4000000",
  currency: "INR",
  expectedAmountMinor: "4500000",
  decidedByUserId: "33333333-3333-4333-8333-333333333333",
  decidedByDisplayName: "Founder",
  overrideReason: "Board-approved exception for this vendor.",
  decidedAt: "2026-08-25T10:00:00.000Z",
  authorizationExpiresOn: controlToday,
};

const overCapReconciliation = {
  id: "77777777-7777-4777-8777-777777777777",
  proposalId,
  decisionId,
  evidenceId,
  verdict: "OVER_CAP",
  expectedAmountMinor: "4500000",
  approvedCapMinor: "4000000",
  authorizationCurrency: "INR",
  observedAmountMinor: "5100000",
  observedCurrency: "INR",
  observedEvidenceDate: "2026-08-26",
  outcome: {
    ...proposal.intendedOutcome,
    observedValue: "1000",
    observedOn: controlToday,
    observationBasis: "USER_ENTERED_OBSERVATION",
    verdict: "MISSED",
  },
  reconciledByUserId: "33333333-3333-4333-8333-333333333333",
  reconciledAt: `${controlToday}T10:00:00.000Z`,
};

const standaloneObservation = {
  id: "88888888-8888-4888-8888-888888888888",
  proposalId,
  decisionId,
  observedValue: "1250",
  observedOn: controlToday,
  target: proposal.intendedOutcome,
  observationBasis: "USER_ENTERED_OBSERVATION",
  verdict: "MET",
  observedByUserId: "33333333-3333-4333-8333-333333333333",
  observedAt: `${controlToday}T11:00:00.000Z`,
};

const exceptionReview = {
  id: "99999999-9999-4999-8999-999999999999",
  proposalId,
  decisionId,
  targetKind: "RECONCILIATION",
  targetId: overCapReconciliation.id,
  disposition: "NEW_PROPOSAL_REQUIRED",
  note: "The overage requires a fresh authorization.",
  reviewedByUserId: "33333333-3333-4333-8333-333333333333",
  reviewedAt: `${controlToday}T11:30:00.000Z`,
};

const ownerCapabilities = { canSubmitProposal: true, canDecide: true, canConfigurePolicy: true };
const memberCapabilities = { canSubmitProposal: true, canDecide: false, canConfigurePolicy: false };

type ControlBrief = {
  policy: typeof policy | null;
  proposals: Array<Record<string, unknown>>;
  capabilities: typeof ownerCapabilities;
};

const emptyBrief = (capabilities = ownerCapabilities): ControlBrief => ({ policy, proposals: [], capabilities });

const emptyAttention = {
  attention: [],
  coverage: { coverageBroken: false, automaticSourceCount: 0, limitations: [] },
  sources: [],
  commitments: [],
};

type ControlMock = {
  briefResponse?: { status: number; body: unknown };
  brief?: ControlBrief;
  proposalResponse?: { status: number; body: unknown };
  decisionResponse?: { status: number; body: unknown };
  reconciliationResponse?: { status: number; body: unknown };
  outcomeResponse?: { status: number; body: unknown };
  exceptionReviewResponse?: { status: number; body: unknown };
  candidateResponse?: { status: number; body: unknown };
  commitments?: readonly typeof commitment[];
  blockBrief?: boolean;
};

type Recorded = { url: string; method: string; headers: Record<string, string>; body: string | null };

async function mockWorkspace(page: Page, options: ControlMock = {}) {
  const controlRequests: Recorded[] = [];
  const runtimeProblems: string[] = [];
  page.on("pageerror", (error) => runtimeProblems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    // The browser logs its own notice for a deliberately mocked failure status.
    // Only application-raised console errors are runtime problems.
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) {
      runtimeProblems.push(`console: ${message.text()}`);
    }
  });
  const record = (request: Request) => {
    controlRequests.push({
      url: new URL(request.url()).pathname,
      method: request.method(),
      headers: request.headers(),
      body: request.postData(),
    });
  };

  await page.route("**/api/workspaces/current/brief", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: home, meta }) }));
  await page.route("**/api/workspaces/current/recovery-attention", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: emptyAttention, meta }) }));
  await page.route("**/api/workspaces/current/activation", (route) =>
    route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ data: { recorded: true, id: "event-1", outcome: "recorded" }, meta }) }));
  await page.route("**/api/workspaces/current/sources", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { alias: null, state: "NOT_PROVISIONED", setupCompletedAt: null, forwardingVerifiedAt: null, acceptedEventCount: 0, rejectedEventCount: 0, recentEvents: [] }, meta }) }));
  await page.route("**/api/workspaces/current/evidence/*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: evidence, meta }) }));
  await page.route("**/api/workspaces/current/commitments**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const commitments = options.commitments ?? [commitment];
    const body = path.endsWith("/commitments")
      ? { data: { items: commitments, total: commitments.length, nextCursor: null }, meta }
      : { data: detail, meta };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  await page.route("**/api/workspaces/current/control/brief", async (route) => {
    record(route.request());
    if (options.blockBrief) {
      await new Promise((resolve) => setTimeout(resolve, 4_000));
    }
    const response = options.briefResponse ?? {
      status: 200,
      body: { data: options.brief ?? emptyBrief(), meta },
    };
    return route.fulfill({ status: response.status, contentType: "application/json", body: JSON.stringify(response.body) });
  });

  await page.route("**/api/workspaces/current/control/proposals", (route) => {
    record(route.request());
    const response = options.proposalResponse ?? {
      status: 201,
      body: { data: { proposal, evaluation }, meta: { requestId: "request-proposal", workspaceVersion: 5 } },
    };
    return route.fulfill({ status: response.status, contentType: "application/json", body: JSON.stringify(response.body) });
  });

  await page.route("**/api/workspaces/current/control/proposals/*/decision", (route) => {
    record(route.request());
    const response = options.decisionResponse ?? {
      status: 201,
      body: { data: { decision }, meta: { requestId: "request-decision", workspaceVersion: 6 } },
    };
    return route.fulfill({ status: response.status, contentType: "application/json", body: JSON.stringify(response.body) });
  });

  await page.route("**/api/workspaces/current/control/proposals/*/reconciliations", (route) => {
    record(route.request());
    const response = options.reconciliationResponse ?? {
      status: 201,
      body: { data: { proposal, decision, reconciliation: overCapReconciliation }, meta: { requestId: "request-reconcile", workspaceVersion: 7 } },
    };
    return route.fulfill({ status: response.status, contentType: "application/json", body: JSON.stringify(response.body) });
  });

  await page.route("**/api/workspaces/current/control/proposals/*/reconciliation-candidates", (route) => {
    record(route.request());
    const response = options.candidateResponse ?? {
      status: 200,
      body: {
        data: {
          proposalId: proposal.id,
          matchingPerformed: false,
          candidates: [{
            evidenceId,
            commitmentId: commitment.id,
            commitmentMerchant: commitment.merchant,
            observedAmountMinor: evidence.amount.minor,
            observedCurrency: evidence.amount.currency,
            observedEvidenceDate: evidence.date,
            basis: "SAME_CURRENCY_WITHIN_AUTHORIZATION_WINDOW",
            requiresHumanConfirmation: true,
          }],
        },
        meta,
      },
    };
    return route.fulfill({ status: response.status, contentType: "application/json", body: JSON.stringify(response.body) });
  });

  await page.route("**/api/workspaces/current/control/proposals/*/outcome", (route) => {
    record(route.request());
    const response = options.outcomeResponse ?? {
      status: 201,
      body: { data: { proposal, decision, observation: standaloneObservation }, meta: { requestId: "request-outcome", workspaceVersion: 7 } },
    };
    return route.fulfill({ status: response.status, contentType: "application/json", body: JSON.stringify(response.body) });
  });

  await page.route("**/api/workspaces/current/control/proposals/*/exception-reviews", (route) => {
    record(route.request());
    const response = options.exceptionReviewResponse ?? {
      status: 201,
      body: { data: { review: exceptionReview }, meta: { requestId: "request-exception-review", workspaceVersion: 8 } },
    };
    return route.fulfill({ status: response.status, contentType: "application/json", body: JSON.stringify(response.body) });
  });

  await page.route("**/api/workspaces/current/control/policy", (route) => {
    record(route.request());
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ data: { policy: { ...policy, policyVersion: 4 } }, meta: { requestId: "request-policy", workspaceVersion: 5 } }),
    });
  });

  return { controlRequests, runtimeProblems };
}

// Each sign-in gets its own rate-limit identity, so one test can never exhaust
// the development-login budget of the next one.
let signInIdentity = 0;
const signInIpOffset = Number.parseInt(process.env.VOGNARY_E2E_IP_OFFSET ?? "0", 10);

async function signIn(page: Page) {
  signInIdentity += 1;
  const lastOctet = ((signInIpOffset + signInIdentity) % 220) + 20;
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `198.51.100.${lastOctet}` });
  await page.goto("/login");
  await page.getByText("Other ways to sign in").click();
  await page.getByPlaceholder("developer@example.com").fill(email!);
  await page.getByPlaceholder("Access code").fill(accessCode!);
  await page.getByRole("button", { name: "Sign in as developer" }).click();
  await page.waitForURL(/\/app/);
  // Leave the signed-in page before the mocks are installed, so only requests
  // made by the page under test are recorded.
  await page.goto("about:blank");
}

const composerHeading = "What are you considering committing to?";

/** The composer collapses once the desk has records, so opening it is a step. */
async function openComposer(page: Page) {
  const heading = page.getByRole("heading", { name: composerHeading });
  await heading.waitFor();
  if (!(await page.getByLabel("Merchant or counterparty").isVisible())) await heading.click();
  await expect(page.getByLabel("Merchant or counterparty")).toBeVisible();
}

async function fillProposal(page: Page) {
  await page.getByLabel("Merchant or counterparty").fill("Anthropic");
  await page.getByLabel("Purpose").fill("Claude API for the product loop");
  await page.getByLabel("Category").selectOption("AI_MODEL");
  await page.getByLabel("Cadence").selectOption("MONTHLY");
  await page.getByLabel("Amount per charge").fill("45000.00");
  await page.getByLabel("Currency").selectOption("INR");
  await page.getByLabel("First charge date").fill(controlToday);
  await page.getByLabel("Metric").fill("Resolved support cases");
  await page.getByLabel("Target direction").selectOption("AT_LEAST");
  await page.getByLabel("Target value").fill("1200");
  await page.getByLabel("Unit").fill("cases");
  await page.getByLabel("Review date").fill(controlToday);
}

async function expectNoSeriousAxeViolations(page: Page) {
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations.filter(({ impact }) => impact === "serious" || impact === "critical")).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

async function waitForCall(calls: Recorded[], predicate: (call: Recorded) => boolean) {
  await expect.poll(() => calls.filter(predicate).length).toBeGreaterThan(0);
  return calls.find(predicate)!;
}

test("a workspace outside the private pilot keeps the Control destination and sees the loop as a labelled demonstration", async ({ page }) => {
  await signIn(page);
  const { controlRequests, runtimeProblems } = await mockWorkspace(page, {
    briefResponse: {
      status: 503,
      body: { error: { code: "FEATURE_UNAVAILABLE", message: "not enrolled", retryable: false, requestId: "request-gate" } },
    },
  });
  await page.goto("/app");

  // The product the public site sells stays in navigation. Only the live desk
  // is gated, and the gate is never bypassed.
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav.getByRole("button", { name: "Today" })).toBeVisible();
  await expect(nav.getByRole("button", { name: "Decisions" })).toBeVisible();

  await nav.getByRole("button", { name: "Decisions" }).click();
  await expect(page.getByRole("heading", { name: "Live decisions unlock with pilot enrollment" })).toBeVisible();
  await expect(page.getByText("Synthetic demonstration")).toBeVisible();
  await expect(page.getByRole("link", { name: "See the pilot offer" })).toHaveAttribute("href", "/pay");

  // Populated, but unmistakably not this workspace and not writable.
  await expect(page.getByText("Model API vendor (placeholder)")).toBeVisible();
  await expect(page.getByText("Finance owner (placeholder)")).toBeVisible();
  await expect(page.getByText(composerHeading)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Decide this proposal" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Link observed evidence" })).toHaveCount(0);
  await expect(page.getByText("workspace-1")).toHaveCount(0);
  await expect(page.getByText(/waitlist|coming soon/i)).toHaveCount(0);

  // The gated desk is asked for exactly once and never retried behind the gate.
  await expect.poll(() => controlRequests.length).toBe(1);
  await page.waitForTimeout(500);
  expect(controlRequests).toHaveLength(1);
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousAxeViolations(page);
  expect(runtimeProblems).toEqual([]);
});

test("an enrolled owner runs proposal, evaluation, capped authorization, and an over-cap observation", async ({ page }, testInfo) => {
  await signIn(page);
  const { controlRequests, runtimeProblems } = await mockWorkspace(page, {
    commitments: [merchantTextMatchCommitment, commitment],
    proposalResponse: {
      status: 201,
      body: {
        data: { proposal, evaluation },
        meta: {
          requestId: "request-proposal",
          workspaceVersion: 5,
          attentionProjection: "pending-worker-retry",
        },
      },
    },
  });
  await page.goto("/app");

  await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Decisions" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: composerHeading })).toBeInViewport();
  await expect(page.getByRole("heading", { name: "Needs a decision" })).toBeVisible();
  await expect(page.getByText("No proposal has been entered yet. The first one you evaluate appears here.")).toBeVisible();

  await fillProposal(page);
  await page.getByRole("button", { name: "Evaluate proposal" }).click();

  const proposalCall = await waitForCall(controlRequests, (call) => call.method === "POST" && call.url.endsWith("/control/proposals"));
  expect(proposalCall.headers["content-type"]).toBe("application/json");
  expect(proposalCall.headers["if-match"]).toBe('"workspace:4"');
  expect(proposalCall.headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
  expect(JSON.parse(proposalCall.body ?? "{}")).toEqual({
    merchant: "Anthropic",
    purpose: "Claude API for the product loop",
    category: "AI_MODEL",
    amountMinor: "4500000",
    currency: "INR",
    firstChargeDate: controlToday,
    cadence: "MONTHLY",
    existingCommitmentIds: [],
    intendedOutcome: {
      metric: "Resolved support cases",
      targetDirection: "AT_LEAST",
      targetValue: "1200",
      unit: "cases",
      reviewOn: controlToday,
    },
  });

  const card = page.getByRole("article", { name: "Anthropic" });
  await expect(card.getByText("User-entered assumption", { exact: true })).toBeVisible();
  await expect(card.getByText("Cited existing exposure")).toBeVisible();
  await expect(card.getByText("INR 45,000").first()).toBeVisible();
  await expect(card.getByText("INR 1,35,000").first()).toBeVisible();
  await expect(card.getByText("INR 5,40,000").first()).toBeVisible();
  await expect(card.getByText("Outside policy")).toBeVisible();
  await expect(card.getByText("Policy version 3")).toBeVisible();
  await expect(card.getByText("The per-charge limit is exceeded.")).toBeVisible();
  await expect(card.getByText("Human decision required")).toBeVisible();
  await expect(page.getByText("The record is saved; its reminder queue needs another pass")).toBeVisible();
  await expect(card.getByText(/\bapproved\b|\bsafe\b|\bcompliant\b|\brecommended\b/i)).toHaveCount(0);
  await expect(page.getByLabel("Merchant or counterparty")).toHaveValue("");

  const controlAttention = page.getByRole("region", { name: "Needs you" });
  await expect(controlAttention).toBeVisible();
  await expect(controlAttention.getByText("Decision needed")).toBeVisible();
  await expect(controlAttention.getByText("Anthropic", { exact: true })).toBeVisible();
  await controlAttention.getByRole("button", { name: "Decide now" }).click();
  const dialog = page.getByRole("dialog", { name: "Authorize this obligation" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Vognary records your decision. It does not purchase, provision, cancel, or move any money.")).toBeVisible();
  await dialog.getByRole("radio", { name: /Approve with cap/ }).check();
  await dialog.getByLabel("Authorization expires on").fill(controlToday);
  await dialog.getByLabel("Approved cap per charge (INR)").fill("40000");
  await dialog.getByLabel("Why this outside-policy proposal is authorized").fill("Board-approved exception for this vendor.");
  await dialog.getByRole("button", { name: "Record decision" }).click();

  const decisionCall = await waitForCall(controlRequests, (call) => call.url.endsWith("/decision"));
  expect(decisionCall.method).toBe("POST");
  expect(decisionCall.headers["if-match"]).toBe('"workspace:5"');
  expect(JSON.parse(decisionCall.body ?? "{}")).toEqual({
    action: "APPROVE_WITH_CAP",
    approvedCapMinor: "4000000",
    authorizationExpiresOn: controlToday,
    overrideReason: "Board-approved exception for this vendor.",
  });

  const authorized = page.getByRole("article", { name: "Anthropic" });
  await expect(authorized.getByText("Approved with a cap")).toBeVisible();
  await expect(authorized.getByText("INR 40,000").first()).toBeVisible();

  await authorized.getByRole("button", { name: "Link observed evidence" }).click();
  const linkDialog = page.getByRole("dialog", { name: "Link observed evidence" });
  const candidateRegion = linkDialog.getByRole("region", { name: "Receipts available to review" });
  await expect(candidateRegion.getByText(/Vognary did not match a merchant or choose a receipt/)).toBeVisible();
  await candidateRegion.getByRole("button", { name: "Review this saved bill" }).click();
  await expect(linkDialog.getByLabel("Saved bill to take the receipt from")).toHaveValue(commitment.id);
  await expect(linkDialog.getByText(/not matched by Vognary/)).toBeVisible();
  await linkDialog.getByRole("radio").first().check();
  await linkDialog.getByLabel("Observed value (cases)").fill("1000");
  await linkDialog.getByLabel("Observed on").fill(controlToday);
  await linkDialog.getByRole("button", { name: "Link this receipt" }).click();

  const reconcileCall = await waitForCall(controlRequests, (call) => call.url.endsWith("/reconciliations"));
  expect(reconcileCall.headers["if-match"]).toBe('"workspace:6"');
  expect(JSON.parse(reconcileCall.body ?? "{}")).toEqual({
    evidenceId,
    observedOutcome: { value: "1000", observedOn: controlToday },
  });

  const settled = page.getByRole("article", { name: "Anthropic" });
  await expect(settled.getByText("Over the frozen cap")).toBeVisible();
  await expect(settled.getByText("The observed amount is above the frozen cap. The cap itself is unchanged.")).toBeVisible();
  await expect(settled.getByText("INR 51,000").first()).toBeVisible();
  await expect(settled.getByText("Outcome missed")).toBeVisible();
  await expect(settled.getByText(`1000 cases observed on ${controlToday}.`)).toBeVisible();
  await expect(settled.getByText("User-entered outcome observation · not Recovery evidence or independently verified proof")).toBeVisible();
  // The frozen cap is still the authorized figure, not the observed one.
  await expect(settled.getByText("INR 40,000").first()).toBeVisible();

  await page.getByRole("button", { name: "Record disposition" }).first().click();
  const exceptionDialog = page.getByRole("dialog", { name: "Record the exception disposition" });
  await exceptionDialog.getByRole("radio", { name: "A new proposal is required" }).check();
  await exceptionDialog.getByLabel("Why this disposition was chosen").fill("The overage requires a fresh authorization.");
  await exceptionDialog.getByRole("button", { name: "Record disposition" }).click();
  const reviewCall = await waitForCall(controlRequests, (call) => call.url.endsWith("/exception-reviews"));
  expect(JSON.parse(reviewCall.body ?? "{}")).toEqual({
    targetKind: "RECONCILIATION",
    targetId: overCapReconciliation.id,
    disposition: "NEW_PROPOSAL_REQUIRED",
    note: "The overage requires a fresh authorization.",
  });
  await expect(settled.getByText("New proposal required")).toBeVisible();
  await expect(settled.getByText("Over the frozen cap")).toBeVisible();
  await expect(page.getByRole("button", { name: "Record disposition" })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousAxeViolations(page);
  expect(runtimeProblems).toEqual([]);
  const surface = testInfo.project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  await page.screenshot({ path: evidencePath(`cc-v0-control-desk-${surface}.png`), fullPage: true, animations: "disabled" });
});

test("an owner records a business outcome without attaching a receipt", async ({ page }) => {
  await signIn(page);
  const { controlRequests } = await mockWorkspace(page, {
    brief: {
      policy,
      proposals: [{
        proposal,
        evaluation,
        decision,
        reconciliations: [],
        outcomeObservations: [],
        exceptionReviews: [],
      }],
      capabilities: ownerCapabilities,
    },
  });
  await page.goto("/app");

  await page.getByRole("button", { name: "Record outcome" }).click();
  const dialog = page.getByRole("dialog", { name: "Record the observed outcome" });
  await expect(dialog.getByText(/not a receipt or independently verified proof/i)).toBeVisible();
  await dialog.getByLabel("Observed value (cases)").fill("1250");
  await dialog.getByRole("button", { name: "Record outcome" }).click();

  const outcomeCall = await waitForCall(controlRequests, (call) => call.url.endsWith("/outcome"));
  expect(JSON.parse(outcomeCall.body ?? "{}")).toEqual({
    observedOutcome: { value: "1250", observedOn: controlToday },
  });
  expect(outcomeCall.body).not.toContain("evidenceId");
  const record = page.getByRole("article", { name: "Anthropic" });
  await expect(record.getByText("Outcome met")).toBeVisible();
  await expect(record.getByText(/Not Recovery evidence or independently verified proof/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Record outcome" })).toHaveCount(0);
  await expectNoSeriousAxeViolations(page);
});

test("a member may propose but never sees a decision or policy command", async ({ page }) => {
  await signIn(page);
  await mockWorkspace(page, {
    brief: {
      policy,
      proposals: [{ proposal, evaluation, decision: null, reconciliations: [], outcomeObservations: [], exceptionReviews: [] }],
      capabilities: memberCapabilities,
    },
  });
  await page.goto("/app");

  await expect(page.getByRole("heading", { name: composerHeading })).toBeVisible();
  await openComposer(page);
  await expect(page.getByRole("button", { name: "Evaluate proposal" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Decide this proposal" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Record a new policy version" })).toHaveCount(0);
  await expect(page.getByText("This proposal is waiting on a workspace owner or admin. No decision has been recorded yet.")).toBeVisible();
  await expect(page.getByText("Only a workspace owner or admin can record a new policy version.")).toBeVisible();
  await expectNoSeriousAxeViolations(page);
});

test("all three policy statuses read as policy context, never as an authorization", async ({ page }) => {
  await signIn(page);
  await mockWorkspace(page, {
    brief: {
      policy,
      proposals: [
        {
          proposal: { ...proposal, id: "a4444444-4444-4444-8444-444444444401", merchant: "Vercel" },
          evaluation: { ...evaluation, id: "a5555555-5555-4555-8555-555555555501", proposalId: "a4444444-4444-4444-8444-444444444401", status: "WITHIN_POLICY", reasonCodes: [], citedEvidenceIds: [], citedExposureBasis: "NONE" },
          decision: null,
          reconciliations: [],
          outcomeObservations: [],
          exceptionReviews: [],
        },
        {
          proposal: { ...proposal, id: "a4444444-4444-4444-8444-444444444402", merchant: "Figma" },
          evaluation: { ...evaluation, id: "a5555555-5555-4555-8555-555555555502", proposalId: "a4444444-4444-4444-8444-444444444402", status: "REVIEW_REQUIRED", reasonCodes: ["CATEGORY_REQUIRES_REVIEW"] },
          decision: null,
          reconciliations: [],
          outcomeObservations: [],
          exceptionReviews: [],
        },
        { proposal, evaluation, decision: null, reconciliations: [], outcomeObservations: [], exceptionReviews: [] },
      ],
      capabilities: ownerCapabilities,
    },
  });
  await page.goto("/app");

  const within = page.getByRole("article", { name: "Vercel" });
  const review = page.getByRole("article", { name: "Figma" });
  const outside = page.getByRole("article", { name: "Anthropic" });
  // Only the proposal being decided is read in full; the rest of the queue
  // keeps its verdict visible and opens the reasoning on demand.
  for (const record of [review, outside]) {
    const disclosure = record.locator("summary", { hasText: "INR 45,000" });
    await expect(disclosure).toBeVisible();
    await disclosure.click();
  }
  await expect(within.getByText("Within policy")).toBeVisible();
  await expect(within.getByText("Policy found no limit or posture that this proposal crosses. It is not approved.")).toBeVisible();
  await expect(within.getByText("None cited, so the exposure below counts this proposal alone.")).toBeVisible();
  await expect(review.getByText("Review required")).toBeVisible();
  await expect(review.getByText("Policy marks this category for review.")).toBeVisible();
  await expect(outside.getByText("Outside policy")).toBeVisible();
  await expect(outside.getByText("The per-charge limit is exceeded.")).toBeVisible();
  await expect(page.getByText("Human decision required")).toHaveCount(3);
  await expect(page.getByText(/\bsafe\b|\bcompliant\b|\brecommended\b/i)).toHaveCount(0);
  await expectNoSeriousAxeViolations(page);
});

test("all six observed verdicts render without false success or failure language", async ({ page }) => {
  const verdicts = ["MATCHED", "WITHIN_CAP", "OVER_CAP", "CURRENCY_MISMATCH", "CANNOT_EVALUATE", "AUTHORIZATION_EXPIRED"] as const;
  const fullCapDecision = { ...decision, action: "APPROVE" as const, approvedCapMinor: decision.expectedAmountMinor };
  await signIn(page);
  await mockWorkspace(page, {
    brief: {
      policy,
      proposals: [{
        proposal,
        evaluation,
        decision: fullCapDecision,
        reconciliations: verdicts.map((verdict, index) => ({
          ...overCapReconciliation,
          id: `8888888${index}-8888-4888-8888-88888888888${index}`,
          verdict,
          approvedCapMinor: fullCapDecision.approvedCapMinor,
          observedAmountMinor: verdict === "MATCHED"
            ? fullCapDecision.expectedAmountMinor
            : verdict === "WITHIN_CAP"
              ? "4000000"
              : verdict === "CANNOT_EVALUATE"
                ? null
                : "5100000",
          observedCurrency: verdict === "CURRENCY_MISMATCH" ? "USD" : verdict === "CANNOT_EVALUATE" ? null : "INR",
          observedEvidenceDate: verdict === "AUTHORIZATION_EXPIRED" ? "2026-10-01" : "2026-08-26",
        })),
        outcomeObservations: [],
        exceptionReviews: [],
      }],
      capabilities: ownerCapabilities,
    },
  });
  await page.goto("/app");

  for (const label of [
    "Matched the frozen amount",
    "Within the frozen cap",
    "Over the frozen cap",
    "Different currency — not comparable",
    "Cannot be evaluated",
    "Outside the authorization window",
  ]) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(page.getByText("No comparable amount published").first()).toBeVisible();
  await expect(page.getByText(/\bfailed\b|\bviolation\b|\bsuccess\b/i)).toHaveCount(0);
  await expect(page.getByText("The frozen cap never changes. A later observation is appended below it, whatever it shows.")).toBeVisible();
  // The authorization is printed once, above the cap line, whatever any later
  // observation shows: five observations must not reprint five caps.
  await expect(page.getByText("Frozen cap", { exact: true })).toHaveCount(1);
  await expect(page.getByText("Frozen before", { exact: true })).toHaveCount(1);
  await expectNoSeriousAxeViolations(page);
});

test("a stale workspace keeps the unsent entry and asks for a review before resending", async ({ page }) => {
  await signIn(page);
  const { controlRequests } = await mockWorkspace(page, {
    proposalResponse: {
      status: 412,
      body: { error: { code: "STALE_STATE", message: "moved on", retryable: true, requestId: "request-stale", currentVersion: 9 } },
    },
  });
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: composerHeading })).toBeVisible();

  await fillProposal(page);
  const briefReadsBeforeSubmit = controlRequests.filter((call) => call.url.endsWith("/control/brief")).length;
  await page.getByRole("button", { name: "Evaluate proposal" }).click();

  await expect(page.getByText("Your entry was kept, not sent")).toBeVisible();
  await expect(page.getByLabel("Merchant or counterparty")).toHaveValue("Anthropic");
  await expect(page.getByLabel("Amount per charge")).toHaveValue("45000.00");
  // The desk reloads the brief once, and never silently resends the proposal.
  await expect.poll(() => controlRequests.filter((call) => call.url.endsWith("/control/brief")).length).toBe(briefReadsBeforeSubmit + 1);
  expect(controlRequests.filter((call) => call.method === "POST").length).toBe(1);
  await expectNoSeriousAxeViolations(page);
});

test("a replayed key with a different payload is reported, never rendered as saved", async ({ page }) => {
  await signIn(page);
  await mockWorkspace(page, {
    proposalResponse: {
      status: 409,
      body: { error: { code: "CONFLICT", message: "key reused", retryable: false, requestId: "request-conflict" } },
    },
  });
  await page.goto("/app");

  await fillProposal(page);
  await page.getByRole("button", { name: "Evaluate proposal" }).click();

  await expect(page.getByText("Conflicting change")).toBeVisible();
  await expect(page.getByRole("article", { name: "Anthropic" })).toHaveCount(0);
  await expect(page.getByLabel("Merchant or counterparty")).toHaveValue("Anthropic");
});

test("an in-flight brief, an empty ledger, a missing policy, and an offline device all stay honest", async ({ page, context }) => {
  await signIn(page);
  await mockWorkspace(page, { blockBrief: true });
  await page.goto("/app");

  // While the brief is in flight the destination exists but stays quiet: Home is
  // still the first screen, and nothing about the desk is claimed yet.
  await expect(page.getByRole("heading", { name: "Decide now" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Decisions" })).toBeVisible();
  await expect(page.getByText("Live decisions unlock with pilot enrollment")).toHaveCount(0);

  await page.unrouteAll({ behavior: "ignoreErrors" });
  await mockWorkspace(page, { brief: { policy: null, proposals: [], capabilities: ownerCapabilities } });
  await page.reload();

  await expect(page.getByText("Record the first policy version")).toBeVisible();
  await expect(page.getByRole("button", { name: "Evaluate proposal" })).toBeDisabled();
  await expect(page.getByText("No policy version exists yet, so no proposal can be evaluated. A workspace owner or admin has to record one first.")).toBeVisible();
  await expect(page.getByText("No proposal has been decided yet.")).toBeVisible();
  await expect(page.getByText("No policy version has been recorded in this workspace.")).toBeVisible();
  await expectNoSeriousAxeViolations(page);

  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.getByText("This device is offline").first()).toBeVisible();
  await context.setOffline(false);
});

test("the composer and dialog are usable with a keyboard alone", async ({ page }) => {
  await signIn(page);
  await mockWorkspace(page, {
    brief: { policy, proposals: [{ proposal, evaluation, decision: null, reconciliations: [], outcomeObservations: [], exceptionReviews: [] }], capabilities: ownerCapabilities },
  });
  await page.goto("/app");

  // A populated desk keeps the composer collapsed so the queue is reached first,
  // so a keyboard user opens it before typing, exactly as the pointer user does.
  await openComposer(page);
  await page.getByLabel("Merchant or counterparty").focus();
  await page.keyboard.type("Anthropic");
  await expect(page.getByLabel("Merchant or counterparty")).toHaveValue("Anthropic");

  const decideButton = page.getByRole("button", { name: "Decide this proposal" });
  await decideButton.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Authorize this obligation" });
  await expect(dialog).toBeVisible();

  // The trap keeps focus inside the dialog even when tabbing backwards.
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.locator(":focus")).toHaveCount(1);
  await expect(dialog.getByRole("radio", { name: /Decline/ })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(decideButton).toBeFocused();
  await expect(page.locator("p[role='status'][aria-live='polite'][aria-atomic='true']")).toHaveCount(2);
});

test("Control honours reduced motion and fits a 390px viewport", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page);
  await mockWorkspace(page, {
    brief: {
      policy,
      proposals: [{ proposal: { ...proposal, merchant: "Anthropic PBC with an unusually long counterparty name for layout", purpose: "A deliberately long purpose sentence that has to wrap without pushing the workspace sideways on a narrow phone." }, evaluation, decision, reconciliations: [overCapReconciliation], outcomeObservations: [], exceptionReviews: [] }],
      capabilities: ownerCapabilities,
    },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app");

  // Attention before creation: on a populated desk the queue owns the first
  // screen and the composer waits behind its own disclosure.
  await expect(page.getByRole("heading", { name: "Needs a decision" })).toBeInViewport();
  await expect(page.getByRole("heading", { name: composerHeading })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Needs a decision" })).toHaveCount(1);

  const motion = await page.evaluate(() => ({
    scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
    buttonTransition: getComputedStyle(document.querySelector<HTMLElement>(".btn")!).transitionDuration,
  }));
  expect(motion.scrollBehavior).toBe("auto");
  expect(motion.buttonTransition.split(",").every((duration) => durationToMs(duration) <= 0.001)).toBe(true);

  await expectNoHorizontalOverflow(page);
  await expectNoSeriousAxeViolations(page);
});

/**
 * The signature record. An authorization frozen at INR 1,350 against a later
 * observation of INR 1,700 is the state the whole product exists to produce, so
 * it is asserted from a fixed contract payload rather than reached by typing:
 * the authorization is printed once, the cap does not move when evidence lands,
 * and the exact server verdict names the breach without a client-derived ratio.
 */
const capLineDecision = {
  ...decision,
  approvedCapMinor: "135000",
  expectedAmountMinor: "170000",
  overrideReason: "Board-approved exception for this vendor.",
};

const capLineBrief = {
  policy,
  proposals: [{
    proposal: { ...proposal, merchant: "Cursor Pro", purpose: "Editor seats for the product loop", amountMinor: "170000" },
    evaluation,
    decision: capLineDecision,
    reconciliations: [{
      ...overCapReconciliation,
      expectedAmountMinor: "170000",
      approvedCapMinor: "135000",
      observedAmountMinor: "170000",
      observedCurrency: "INR",
      verdict: "OVER_CAP" as const,
    }],
    outcomeObservations: [],
    exceptionReviews: [],
  }],
  capabilities: ownerCapabilities,
};

// 720x450 is the CSS viewport a 1440x900 desktop exposes at 200% browser zoom.
for (const viewport of [{ label: "1440x900", width: 1440, height: 900 }, { label: "1280x800", width: 1280, height: 800 }, { label: "720x450-zoom200", width: 720, height: 450 }, { label: "390x844", width: 390, height: 844 }, { label: "360x800", width: 360, height: 800 }]) {
  test(`an observation of INR 1,700 against a frozen INR 1,350 cap reads as one record at ${viewport.label}`, async ({ page }, testInfo) => {
    await signIn(page);
    await mockWorkspace(page, { brief: capLineBrief });
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/app");

    const record = page.getByRole("article", { name: "Cursor Pro" });
    await expect(record).toBeVisible();

    // Both sides of the comparison are on screen together, exactly once each.
    // Scoped to the ledger: the proposal's own assumed amount legitimately
    // appears again inside the policy-reading disclosure, as a different class.
    const ledger = record.locator(".ledger");
    await expect(ledger.getByText("INR 1,350", { exact: true })).toHaveCount(1);
    await expect(ledger.getByText("INR 1,700", { exact: true })).toHaveCount(2); // proposed + observed
    await expect(record.getByText("Authorized cap", { exact: true })).toHaveCount(1);
    await expect(record.getByText("Over the frozen cap")).toBeVisible();
    await expect(record.getByText("The observed amount is above the frozen cap. The cap itself is unchanged.")).toBeVisible();

    // Actor, policy version and evidence access sit in the same record.
    await expect(record.getByText(/Founder .* policy version 3/)).toBeVisible();
    await expect(record.getByRole("button", { name: "Open the observed receipt" })).toBeVisible();
    await expect(ledger.locator(".ledger-verdict > .control-card-meta")).toHaveCount(2);
    const disclosures = await ledger.locator(".ledger-verdict > .control-card-meta, .ledger-verdict > .link-quiet").evaluateAll((elements) => elements.map((element) => {
      const bounds = element.getBoundingClientRect();
      return { text: element.textContent, left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom };
    }));
    expect(disclosures).toHaveLength(3);
    for (let first = 0; first < disclosures.length; first += 1) {
      for (let second = first + 1; second < disclosures.length; second += 1) {
        const horizontalIntersection = Math.min(disclosures[first].right, disclosures[second].right) - Math.max(disclosures[first].left, disclosures[second].left);
        const verticalIntersection = Math.min(disclosures[first].bottom, disclosures[second].bottom) - Math.max(disclosures[first].top, disclosures[second].top);
        expect(horizontalIntersection <= 0 || verticalIntersection <= 0, `${disclosures[first].text} overlaps ${disclosures[second].text}`).toBe(true);
      }
    }

    // Nothing invents a difference between the two figures.
    await expect(record.getByText(/INR\s*350/)).toHaveCount(0);
    await expect(record.getByText(/\bblocked\b|\breversed\b|\brefunded\b|\bstopped\b/i)).toHaveCount(0);

    await expectNoHorizontalOverflow(page);
    await expectNoSeriousAxeViolations(page);
    const surface = testInfo.project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    await record.screenshot({ path: evidencePath(`cc-v0-over-cap-record-${viewport.label}-${surface}.png`), animations: "disabled" });
  });
}

/** The cap must not move when later evidence arrives. */
test("linking evidence appends an observation without changing the frozen cap", async ({ page }) => {
  await signIn(page);
  await mockWorkspace(page, {
    brief: { ...capLineBrief, proposals: [{ ...capLineBrief.proposals[0], reconciliations: [], outcomeObservations: [], exceptionReviews: [] }] },
    reconciliationResponse: {
      status: 201,
      body: {
        data: { proposal: capLineBrief.proposals[0].proposal, decision: capLineDecision, reconciliation: capLineBrief.proposals[0].reconciliations[0] },
        meta: { requestId: "request-reconcile", workspaceVersion: 7 },
      },
    },
  });
  await page.goto("/app");

  const record = page.getByRole("article", { name: "Cursor Pro" });
  const capRow = record.locator(".ledger .control-fact", { hasText: "Authorized cap" });
  const before = await capRow.textContent();
  await expect(record.getByText("Awaiting evidence")).toBeVisible();

  await record.getByRole("button", { name: "Link observed evidence" }).click();
  const linkDialog = page.getByRole("dialog", { name: "Link observed evidence" });
  await linkDialog.getByLabel("Saved bill to take the receipt from").selectOption(commitment.id);
  await linkDialog.getByRole("radio").first().check();
  await linkDialog.getByRole("button", { name: "Link this receipt" }).click();

  await expect(record.getByText("Over the frozen cap")).toBeVisible();
  expect(await capRow.textContent()).toBe(before);
  await expect(record.locator(".ledger").getByText("INR 1,350", { exact: true })).toHaveCount(1);
  await expectNoSeriousAxeViolations(page);
});

function durationToMs(duration: string) {
  const value = Number.parseFloat(duration);
  return duration.trim().endsWith("ms") ? value : value * 1_000;
}
