import { randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const email = process.env.VOGNARY_E2E_DEV_LOGIN_EMAIL;
const accessCode = process.env.VOGNARY_E2E_DEV_LOGIN_CODE;
test.skip(!email || !accessCode, "Development login is required.");

async function signIn(page: Page) {
  const identity = randomBytes(12).toString("hex").match(/.{4}/g)!.join(":");
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `2001:db8:${identity}` });
  await page.goto("/login");
  await page.getByText("Other ways to sign in").click();
  await page.getByPlaceholder("developer@example.com").fill(email!);
  await page.getByPlaceholder("Access code").fill(accessCode!);
  const response = page.waitForResponse(value => new URL(value.url()).pathname === "/api/auth/login" && value.request().method() === "POST");
  await page.getByRole("button", { name: "Sign in as developer" }).click();
  expect((await response).status()).toBe(200);
  await page.waitForURL(value => value.pathname === "/app");
}

const bill = { version: 1, billId: "200001", vendorId: "300001", vendorName: "Synthetic connected vendor", billNumber: "SYNTHETIC-001", date: "2026-09-01", status: "open", currency: "INR", totalMinor: "12000", balanceMinor: "12000", sourceTotal: "120", sourceBalance: "120", modifiedAt: "2026-09-06T00:00:00.000Z", basis: "PROVIDER_BILL_TOTAL" };

test("Books setup, returning changes and explicit disconnect/delete stay in the evidence workflow", async ({ page }, testInfo) => {
  await signIn(page);
  const connection = { id: "11111111-1111-4111-8111-111111111111", revision: "1", status: "AWAITING_ORGANIZATION", organizationId: null as string | null, organizationName: null as string | null, coverageStart: "2026-06-08", lastSuccessfulSyncAt: null as string | null, nextScheduledAt: null as string | null, failureCode: null, providerRevocation: null as string | null };
  let state = { configured: true, canManage: true, retainedAdmissionCount: 0, retentionNotice: "control-provider-bill-retention-v1", connection: connection as typeof connection | null, organizations: [{ id: "100001", name: "Synthetic Books organization", currency: "INR", active: true }], items: [] as Array<Record<string, unknown>>, total: 0, nextCursor: null, throughSequence: "0" };
  const actions: string[] = [];
  await page.route("**/api/workspaces/current/sources/zoho-books**", route => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      actions.push(body.action);
      if (body.action === "SELECT") {
        expect(body.organizationId).toBe("100001");
        state = { ...state, organizations: [], connection: { ...connection, revision: "2", status: "READY", organizationId: "100001", organizationName: "Synthetic Books organization", lastSuccessfulSyncAt: "2026-09-06T00:00:00.000Z" }, items: [{ sequence: "1", bill, previous: null, changeKind: "BASELINE", observedAt: "2026-09-06T00:00:00.000Z" }], total: 1, throughSequence: "1" };
      }
      if (body.action === "DISCONNECT") state = { ...state, connection: { ...state.connection!, revision: "3", status: "REVOKED", providerRevocation: "CONFIRMED" } };
      if (body.action === "ERASE") {
        expect(body.confirmation).toBe("DELETE_OBSERVATIONS");
        state = { ...state, connection: null, items: [], total: 0, throughSequence: "0" };
      }
    }
    return route.fulfill({ json: { data: state } });
  });
  await page.goto("/app?view=ADD_EVIDENCE");
  const source = page.getByRole("region", { name: "Zoho Books" });
  await expect(source.getByLabel("Choose your organization")).toHaveValue("");
  await expect(source.getByRole("button", { name: "Connect organization" })).toBeDisabled();
  await source.getByLabel("Choose your organization").selectOption("100001");
  await source.getByRole("button", { name: "Connect organization" }).click();
  await expect(source.getByRole("article", { name: "Books bill SYNTHETIC-001" })).toBeVisible();
  await expect(source.getByText("INR 120", { exact: true })).toBeVisible();
  state = { ...state, items: [{ sequence: "2", bill: { ...bill, totalMinor: "13000", balanceMinor: "13000", sourceTotal: "130", sourceBalance: "130" }, previous: bill, changeKind: "AMENDED", observedAt: "2026-09-07T00:00:00.000Z" }], throughSequence: "2" };
  await page.reload();
  await expect(source.getByText("Bill changed", { exact: true })).toBeVisible();
  await expect(source.getByText("INR 130", { exact: true })).toBeVisible();
  await expect(source.getByText("INR 120", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("books-changed-bill.png"), fullPage: true });
  await source.getByText("Source details", { exact: true }).click();
  await expect(source.getByText(/Immutable source revision 2/)).toBeVisible();
  await source.getByRole("button", { name: "Disconnect", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  expect(actions).toEqual(["SELECT"]);
  await source.getByRole("button", { name: "Disconnect", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(source.getByText("Disconnected", { exact: true })).toBeVisible();
  await source.getByRole("button", { name: "Delete observations" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete observations" }).click();
  await expect(source.getByRole("article")).toHaveCount(0);
  expect(actions).toEqual(["SELECT", "DISCONNECT", "ERASE"]);
  const accessibility = await new AxeBuilder({ page }).include("[aria-labelledby=zoho-books-heading]").analyze();
  expect(accessibility.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("books-source.png"), fullPage: true });
});

test("unavailable access and read-only members never receive an enabled connection action", async ({ page }) => {
  await signIn(page);
  let configured = false;
  let canManage = true;
  await page.route("**/api/workspaces/current/sources/zoho-books**", route => route.fulfill({ json: { data: {
    configured, canManage, connection: null, organizations: [], items: [], total: 0, nextCursor: null, throughSequence: "0",
  } } }));
  await page.goto("/app?view=ADD_EVIDENCE");
  const source = page.getByRole("region", { name: "Zoho Books" });
  await expect(source.getByText(/Access is not configured/)).toBeVisible();
  await expect(source.getByRole("button", { name: "Connect Zoho Books" })).toHaveCount(0);
  configured = true;
  canManage = false;
  await source.getByRole("button", { name: "Reload Books observations" }).click();
  await expect(source.getByText("An owner or admin manages source access.")).toBeVisible();
  await expect(source.getByRole("button", { name: "Connect Zoho Books" })).toHaveCount(0);
  canManage = true;
  await source.getByRole("button", { name: "Reload Books observations" }).click();
  await expect(source.getByRole("button", { name: "Connect Zoho Books" })).toBeDisabled();
  await source.getByRole("checkbox").check();
  await expect(source.getByRole("button", { name: "Connect Zoho Books" })).toBeEnabled();
});

test("malformed source responses and unknown writes cannot appear as financial success", async ({ page }) => {
  await signIn(page);
  let valid = false;
  await page.route("**/api/workspaces/current/sources/zoho-books**", route => {
    if (route.request().method() === "POST") return route.abort("failed");
    return route.fulfill({ json: { data: valid ? {
      configured: true, canManage: true, connection: null, organizations: [], items: [], total: 0, nextCursor: null, throughSequence: "0",
    } : { configured: true, connection: { status: "READY" }, items: [{ bill: { totalMinor: "NaN", currency: "INR" } }] } } });
  });
  await page.goto("/app?view=ADD_EVIDENCE");
  const source = page.getByRole("region", { name: "Zoho Books" });
  await expect(source.getByRole("alert")).toContainText("could not be verified");
  await expect(source.getByRole("article")).toHaveCount(0);
  await expect(source.getByText("NaN", { exact: true })).toHaveCount(0);
  valid = true;
  await source.getByRole("button", { name: "Reload Books observations" }).click();
  await source.getByRole("checkbox").check();
  await source.getByRole("button", { name: "Connect Zoho Books" }).click();
  await expect(source.getByRole("alert")).toContainText("result is unconfirmed");
  await expect(source.getByRole("alert")).not.toContainText("Nothing was sent");
});
