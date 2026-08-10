import { expect, test, type Page } from "@playwright/test";

/**
 * Recovery v1 — honest states, evidence submission, and the profile surface.
 * Same harness as recovery-ui-home.spec.ts: a real development-login session for
 * the server-rendered shell, mocked contract payloads for everything else.
 */

const email = process.env.VOGNARY_E2E_DEV_LOGIN_EMAIL;
const accessCode = process.env.VOGNARY_E2E_DEV_LOGIN_CODE;

test.skip(!email || !accessCode, "development login env not configured");

const meta = { requestId: "request-e2e", workspaceVersion: 4 };

const emptyHome = {
  workspace: { id: "workspace-1", name: "Founder workspace", role: "owner", version: 4 },
  generatedAt: "2026-08-09T10:00:00.000Z",
  monthlyTotals: [],
  next30DayTotals: [],
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

async function mockEmptyWorkspace(page: Page) {
  await page.route("**/api/workspaces/current/brief", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: emptyHome, meta }) }),
  );
  await page.route("**/api/workspaces/current/commitments**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { items: [], total: 0, nextCursor: null }, meta }) }),
  );
}

test("an empty workspace offers exactly one obvious receipt-paste action", async ({ page }) => {
  await signIn(page);
  await mockEmptyWorkspace(page);
  await page.goto("/app");

  await expect(page.getByRole("heading", { name: "Paste your first receipt" })).toBeVisible();
  await expect(page.getByLabel("Receipt or invoice text")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save this receipt as evidence" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save this receipt as evidence" })).toBeDisabled();
  await expect(page.getByText("Import a statement file instead (fallback)")).toBeVisible();
  await expect(page.getByText(/connect|Gmail|bank account/i)).toHaveCount(0);
});

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

  await page.getByLabel("Receipt or invoice text").fill("OpenAI invoice paid INR 1,999 on 2026-07-06. Renews monthly.");
  await page.getByRole("button", { name: "Save this receipt as evidence" }).click();

  const receipt = page.getByRole("region", { name: "What the workspace did with it" });
  await expect(receipt).toBeVisible();
  await expect(receipt.getByText("Accepted", { exact: true })).toBeVisible();
  await expect(receipt.getByText("Nothing could be read")).toBeVisible();
  await expect(receipt.getByText("Already submitted")).toBeVisible();
  await expect(receipt.getByText("Evidence not accepted")).toBeVisible();
  await expect(receipt.getByText("No merchant, amount, and date were found.")).toBeVisible();
  await expect(page.getByLabel("Receipt or invoice text")).toHaveValue(/OpenAI invoice/);
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
  await expect(page.getByLabel("Receipt or invoice text")).toBeVisible();

  await page.context().setOffline(true);
  await expect(page.getByText("This device is offline")).toBeVisible();
  await expect(page.getByText("Offline — nothing can be sent right now.")).toBeVisible();
  await page.context().setOffline(false);
  await expect(page.getByText("This device is offline")).toHaveCount(0);
});

test("profile presents persistence, export, and a confirmed destructive deletion", async ({ page }) => {
  await signIn(page);
  await mockEmptyWorkspace(page);
  await page.goto("/app");

  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Profile" }).click();

  await expect(page.getByText(email!)).toBeVisible();
  await expect(page.getByText("Version 4", { exact: true })).toBeVisible();
  await expect(page.getByText(/Reloading this page, closing the tab/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Open canonical privacy export" })).toHaveAttribute("href", "/profile#privacy-export");

  const trigger = page.getByRole("button", { name: "Delete saved workspace data…" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Delete saved workspace data" });
  await expect(dialog).toBeVisible();
  const confirm = dialog.getByRole("link", { name: "Continue to permanent deletion" });
  await expect(confirm).toHaveAttribute("aria-disabled", "true");

  await dialog.getByLabel(/Type DELETE to confirm/).fill("DELETE");
  await expect(confirm).toHaveAttribute("aria-disabled", "false");

  await dialog.getByRole("button", { name: "Keep my data" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
