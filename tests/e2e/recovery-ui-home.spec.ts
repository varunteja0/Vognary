import { expect, test, type Page } from "@playwright/test";

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
  monthlyTotals: [{ amount: money, commitmentIds: ["commitment-1"], evidenceIds: ["evidence-1"] }],
  next30DayTotals: [{ amount: money, commitmentIds: ["commitment-1"], evidenceIds: ["evidence-1"] }],
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
};

const meta = { requestId: "request-e2e", workspaceVersion: 4 };

type DecisionOutcome = { ok: true } | { ok: false; status: number; body: unknown };

async function mockRecoveryApi(page: Page, options: { decision?: DecisionOutcome } = {}) {
  let currentDetail: Record<string, unknown> = detail;
  let currentMeta = meta;
  await page.route("**/api/workspaces/current/brief", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: home, meta }) }),
  );
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
  await signIn(page);
  await mockRecoveryApi(page);
  await page.goto("/app");

  await expect(page.getByRole("heading", { level: 1, name: "Your subscriptions" })).toBeVisible();
  await expect(page.getByText("Saved to Vognary")).toBeVisible();

  const nav = page.getByRole("navigation", { name: "Primary" });
  for (const label of ["Home", "Subscriptions", "Sources"]) {
    await expect(nav.getByRole("button", { name: label })).toBeVisible();
  }
  await expect(page.getByRole("link", { name: `Account for ${email}` })).toHaveAttribute("href", "/profile");

  await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Coming up" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Receipts checked" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Since your last visit" })).toHaveCount(0);

  await expect(page.getByText("₹1,999.00").first()).toBeVisible();
  await expect(page.getByText("Confirm OpenAI")).toBeVisible();
  await expect(page.getByText("Low confidence")).toBeVisible();
  await expect(page.getByText("6 Aug 2026 · in 3 days")).toBeVisible();
  await expect(page.getByText(/1 item from 1 source · latest/)).toBeVisible();

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
  await expect(page.getByText("Saved to Vognary")).toBeVisible();
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
