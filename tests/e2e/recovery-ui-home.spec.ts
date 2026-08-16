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
      commitmentId: "commitment-1",
      merchant: "OpenAI",
      date: "2026-08-06",
      daysAway: 3,
      amount: money,
      decision: null,
      confidence,
      reminderEligible: true,
      evidenceIds: ["evidence-1"],
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
  activeCommitmentCount: 1,
  reviewItemCount: 1,
};

const meta = { requestId: "request-e2e", workspaceVersion: 4 };

type DecisionOutcome = { ok: true } | { ok: false; status: number; body: unknown };

async function mockRecoveryApi(page: Page, options: { decision?: DecisionOutcome } = {}) {
  let currentDetail: Record<string, unknown> = detail;
  let currentMeta = meta;
  const activationCalls: string[] = [];
  await page.route("**/api/workspaces/current/brief", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: home, meta }) }),
  );
  await page.route("**/api/workspaces/current/activation", (route) => {
    activationCalls.push(route.request().method());
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
  return { activationCalls };
}

async function signIn(page: Page) {
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 180) + 50}` });
  await page.goto("/login");
  await page.getByText("Other ways to sign in").click();
  await page.getByPlaceholder("developer@example.com").fill(email!);
  await page.getByPlaceholder("Access code").fill(accessCode!);
  await page.getByRole("button", { name: "Sign in as developer" }).click();
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
  const { activationCalls } = await mockRecoveryApi(page);
  await page.goto("/app");

  await expect(page.getByRole("heading", { level: 1, name: "Your renewal review" })).toBeVisible();
  await expect(page.getByText("Saved to Vognary")).toHaveText("Saved to Vognary");

  const nav = page.getByRole("navigation", { name: "Primary" });
  for (const label of ["Home", "Subscriptions", "Sources", "Mandate"]) {
    await expect(nav.getByRole("button", { name: label })).toBeVisible();
  }
  await expect(page.getByRole("link", { name: `Account for ${email}` })).toHaveAttribute("href", "/profile");

  await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Coming up" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Receipts checked" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Since your last visit" })).toHaveCount(0);

  await expect(page.getByText("Monthly software spend")).toBeVisible();
  await expect.poll(() => activationCalls.length).toBe(1);
  await expect(page.getByText("From checked receipts only.").first()).toBeVisible();
  await expect(page.getByText("₹1,999.00").first()).toBeVisible();
  await expect(page.getByText("₹23,988.00")).toBeVisible();
  await expect(page.getByText("Annualized estimate", { exact: true })).toBeVisible();
  await expect(page.getByText(/It is not a historical yearly total/)).toBeVisible();
  await expect(page.getByText("Active commitments")).toBeVisible();
  await expect(page.getByText("Needs review")).toBeVisible();
  await expect(page.getByText("Confirm OpenAI")).toBeVisible();
  await expect(page.getByText("Low confidence")).toBeVisible();
  await expect(page.getByText("6 Aug 2026 · in 3 days")).toBeVisible();
  await expect(page.getByText(/1 item from 1 source · latest/)).toBeVisible();
  await expect(page.getByText("Sheets go stale when new charges land.", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Copy for WhatsApp" }).click();
  await expect(page.getByText("WhatsApp summary copied.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as typeof window & { __vognaryCopiedText?: string }).__vognaryCopiedText)).toContain("Monthly burn from checked receipts: ₹1,999.00/mo.");
  expect(await page.evaluate(() => (window as typeof window & { __vognaryCopiedText?: string }).__vognaryCopiedText)).toContain("Annualized estimate (12 × cited monthly equivalent, not a historical yearly total): ₹23,988.00/yr.");

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

  await expect(page.getByRole("heading", { name: "Since your last visit" })).toBeVisible();
  const changedBox = await page.getByRole("heading", { name: "Since your last visit" }).boundingBox();
  const attentionBox = await page.getByRole("heading", { name: "Needs attention" }).boundingBox();
  expect(changedBox?.y).toBeLessThan(attentionBox?.y ?? 0);
  await expect(page.getByText("Amount changed")).toBeVisible();
  const changeRow = page.locator("article").filter({ hasText: "Amount changed" });
  await expect(changeRow.getByText("₹1,999.00")).toBeVisible();
  await expect(changeRow.getByText("₹2,099.00")).toBeVisible();
  await expect(changeRow.getByText("1 new evidence item caused this comparison")).toBeVisible();
  await expect(page.getByText("Your subscriptions look the same")).toHaveCount(0);
});

test("a commitment exposes its exact evidence and returns focus after inspection", async ({ page }) => {
  await signIn(page);
  await mockRecoveryApi(page);
  await page.goto("/app");

  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Subscriptions" }).click();
  await page.getByRole("button", { name: /OpenAI/ }).first().click();

  await expect(page.getByRole("heading", { name: "OpenAI" })).toBeVisible();
  await expect(page.getByText("Confirm this with a second receipt.")).toBeVisible();
  await expect(page.getByText("Showing 1 of 1")).toBeVisible();
  await expect(page.getByText("OpenAI invoice paid INR 1,999. Renews monthly.", { exact: false })).toBeVisible();

  const inspect = page.getByRole("button", { name: "Inspect this evidence" });
  await inspect.click();

  const dialog = page.getByRole("dialog", { name: "Exact evidence" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Observed fact (exact excerpt)")).toBeVisible();
  await expect(dialog.getByText("Pasted receipt", { exact: true }).first()).toBeVisible();
  await expect(dialog.getByText("6 Jul 2026").first()).toBeVisible();
  await expect(dialog.getByText("INR · 199900 in the smallest unit")).toBeVisible();
  await expect(dialog.getByText("You submitted this evidence")).toBeVisible();
  await expect(dialog.getByText("Medium confidence · 72%")).toBeVisible();
  await expect(dialog.getByText("Treat the amount and date as provisional until more evidence lands.")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(inspect).toBeFocused();
});

test("three primary choices and two secondary choices preserve the server decision row", async ({ page }) => {
  await signIn(page);
  await mockRecoveryApi(page);
  await page.goto("/app");

  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Subscriptions" }).click();
  await page.getByRole("button", { name: /OpenAI/ }).first().click();

  const group = page.getByRole("group", { name: "Your choice" });
  for (const label of ["Keep", "Plan to cancel", "Review later"]) {
    await expect(group.getByRole("button", { name: new RegExp(`^${label}`) })).toBeVisible();
  }
  await page.getByText("More choices").click();
  await expect(page.getByRole("button", { name: "Consider a cheaper plan" })).toBeVisible();
  await expect(page.getByRole("button", { name: "I don’t recognize this" })).toBeVisible();
  await expect(page.getByText("No choice has been saved for this subscription yet.")).toBeVisible();

  await group.getByRole("button", { name: /^Plan to cancel/ }).click();
  await expect(page.getByText(/Saved Plan to cancel on/)).toBeVisible();
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

  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Subscriptions" }).click();
  await page.getByRole("button", { name: /OpenAI/ }).first().click();
  await page.getByRole("group", { name: "Your choice" }).getByRole("button", { name: /^Plan to cancel/ }).click();

  const alert = page.getByRole("alert").filter({ hasText: "Rolled back" });
  await expect(alert).toBeVisible();
  await expect(alert.getByText(/“Plan to cancel” for OpenAI was not saved/)).toBeVisible();
  await expect(alert.getByText(/still without a recorded decision/)).toBeVisible();
  await expect(alert.getByText(/request-rollback/)).toBeVisible();
  await expect(page.getByText("No choice has been saved for this subscription yet.")).toBeVisible();
});

test("correcting a commitment offers every contract field and shows reversible history", async ({ page }) => {
  await signIn(page);
  await mockRecoveryApi(page);
  await page.goto("/app");

  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Subscriptions" }).click();
  await page.getByRole("button", { name: /OpenAI/ }).first().click();

  for (const label of ["Correct merchant", "Correct amount", "Correct expected date", "Correct cadence", "Correct recurring or not"]) {
    await expect(page.getByRole("button", { name: label })).toBeVisible();
  }
  await expect(page.getByText("Merchant set to “OpenAI”")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reverse this correction" })).toBeVisible();

  const trigger = page.getByRole("button", { name: "Correct amount" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Correct amount" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/which is 199900 in the smallest unit of INR/)).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(trigger).toBeFocused();
});

test("the workspace stays usable and keyboard-reachable on a small screen", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page);
  await mockRecoveryApi(page);
  await page.goto("/app");

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);

  const commitmentsTab = page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Subscriptions" });
  await commitmentsTab.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 2, name: "Subscriptions" })).toBeFocused();
});

test("Mandate tab shows the frozen terms and does not claim execution is live", async ({ page }) => {
  await signIn(page);
  await mockRecoveryApi(page);
  await page.goto("/app");

  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Mandate" }).click();
  await expect(page.getByText("No standing mandate is signed")).toBeVisible();
  await expect(page.getByText(/No merchant cancellation route is proven yet/)).toBeVisible();
  await expect(page.getByText("Off — no cancellation is executed")).toBeVisible();
  await expect(page.getByRole("button", { name: "I accept this standing mandate" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Emergency disable" })).toHaveCount(0);
});

test("exception-only Autopilot home is honest on desktop and mobile and has no serious axe issues", async ({ page }) => {
  const autopilotHome = {
    ...home,
    autopilot: {
      executionEnabled: false,
      noticeEnabled: false,
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
      inVeto: [],
      handled: [],
      needsHelp: [],
      proof: [{ candidateId: "candidate-1", status: "PENDING", expectedDebitDate: "2026-09-06", savingMinor: null }],
      fees: null,
      attempts: [],
    },
  };
  await signIn(page);
  await mockRecoveryApi(page);
  await page.route("**/api/workspaces/current/brief", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: autopilotHome, meta }) }),
  );
  await page.goto("/app");

  for (const name of ["Watching", "Veto window", "Handled for you", "Needs your help", "Proof and savings", "Fees and refunds", "Mandate"]) {
    await expect(page.getByRole("heading", { name })).toBeVisible();
  }
  await expect(page.getByText("Exception-only home")).toBeVisible();
  await expect(page.getByText("Monthly software spend")).toBeVisible();
  await expect(page.getByText("From checked receipts only.").first()).toBeVisible();
  await expect(page.getByText("No recurring amount yet")).toHaveCount(0);
  await expect(page.getByText("missing coverage is not a ₹0 saving", { exact: false })).toBeVisible();
  await expect(page.getByText("Fee collection stays fail-closed")).toBeVisible();
  await expect(page.getByText("This is not a connected, cancelled, saved, or paid state.")).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });

  const desktopAxe = await new AxeBuilder({ page }).analyze();
  expect(desktopAxe.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);

  await page.setViewportSize({ width: 375, height: 812 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
  const mobileAxe = await new AxeBuilder({ page }).analyze();
  expect(mobileAxe.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);
});

test("an active mandate still shows the spend strip when no recurring amount is cited", async ({ page }) => {
  const autopilotHome = {
    ...home,
    monthlyTotals: [],
    annualizedEstimateTotals: [],
    next30DayTotals: [],
    activeCommitmentCount: 0,
    reviewItemCount: 0,
    autopilot: {
      executionEnabled: false,
      noticeEnabled: false,
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
      inVeto: [],
      handled: [],
      needsHelp: [],
      proof: [],
      fees: null,
      attempts: [],
    },
  };
  await signIn(page);
  await mockRecoveryApi(page);
  await page.route("**/api/workspaces/current/brief", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: autopilotHome, meta }) }),
  );
  await page.goto("/app");

  await expect(page.getByText("Exception-only home")).toBeVisible();
  await expect(page.getByText("Monthly software spend")).toBeVisible();
  await expect(page.getByText("No recurring amount yet")).toBeVisible();
  await expect(page.getByText("Annualized estimate", { exact: true })).toBeVisible();
  await expect(page.getByText("Active commitments")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Coming up" })).toBeVisible();
  await expect(page.getByText("Baseline only")).toBeVisible();
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
  await expect(page.getByRole("heading", { level: 2, name: "Home" })).toBeVisible();
  await expect(page.getByText("Monthly software spend")).toHaveCount(0);
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
  await expect(page.getByText("Monthly software spend")).toBeVisible();
  await expect.poll(() => activationCalls.length).toBe(1);
  await page.reload();
  await expect(page.getByText("Monthly software spend")).toBeVisible();
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
  await expect(page.getByText("Monthly software spend")).toBeVisible();
  await expect.poll(() => activationCalls.length).toBe(1);
  expect(activationCalls[0]).toEqual({ status: 202 });
  expect(await page.evaluate((key) => sessionStorage.getItem(key), `vognary.workspace-activation.settled:${home.workspace.id}`)).toBeNull();

  consented = true;
  await page.goto("/app");
  await expect(page.getByText("Monthly software spend")).toBeVisible();
  await expect.poll(() => activationCalls.length).toBe(2);
  expect(activationCalls[1]).toEqual({ status: 201 });
  expect(await page.evaluate((key) => sessionStorage.getItem(key), `vognary.workspace-activation.settled:${home.workspace.id}`)).toBe("1");

  await page.reload();
  await expect(page.getByText("Monthly software spend")).toBeVisible();
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
  await expect(page.getByText("Monthly software spend")).toBeVisible();
  await expect.poll(() => activationCalls.length).toBe(1);
  expect(activationCalls[0]).toEqual({ status: 401 });
  expect(await page.evaluate((key) => sessionStorage.getItem(key), `vognary.workspace-activation.settled:${home.workspace.id}`)).toBeNull();

  authenticated = true;
  await page.goto("/app");
  await expect(page.getByText("Monthly software spend")).toBeVisible();
  await expect.poll(() => activationCalls.length).toBe(2);
  expect(activationCalls[1]).toEqual({ status: 201 });

  await page.reload();
  await expect(page.getByText("Monthly software spend")).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(activationCalls).toHaveLength(2);
});
