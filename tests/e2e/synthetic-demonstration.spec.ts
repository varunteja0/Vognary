import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * The reconstruction's load-bearing claim: the product the public site sells is
 * the same product a visitor can experience, and it never disappears at the
 * enrollment boundary.
 *
 * These are journeys, not routes. A green page in isolation proved nothing about
 * whether the promise survives the walk from `/` into the workspace.
 */

test("Journey 1 — a cold visitor reaches a frozen authorization and its outcome without an account", async ({ page }) => {
  const failures = collectRuntimeFailures(page);

  await page.goto("/");
  // Ten-second comprehension: category, the literal promise, one command.
  await expect(page.getByRole("heading", { level: 1 }))
    .toContainText("Vognary");
  await expect(page.getByText("Commitment Control for India-first AI companies")).toBeVisible();

  // The product is the first-viewport subject: the live record, not a diagram.
  // The rejected hero form, ticker and Authority Field are gone.
  const sheet = page.locator(".sheet").first();
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("INR 4,80,000");
  await expect(page.locator(".afield")).toHaveCount(0);
  await expect(page.locator(".landing-signal-track")).toHaveCount(0);
  await expect(page.locator("#control-index")).toHaveCount(0);
  await expect(page.locator("main form")).toHaveCount(0);

  const primary = page.getByRole("link", { name: "Review the synthetic request" }).first();
  await expect(primary).toBeVisible();
  await primary.click();
  await expect(page).toHaveURL(/\/demo$/);

  // The demonstration says what it is, on the first frame and every frame after.
  const stamp = page.getByTestId("synthetic-demonstration-label").first();
  await expect(stamp).toHaveText("Synthetic demonstration");

  // It opens AT the decision: the request, its cited history and the policy
  // result are all present before the visitor does anything.
  await expect(page.getByText("INR 4,80,000").first()).toBeVisible();
  await expect(page.getByText("Assumption").first()).toBeVisible();
  await expect(page.getByText("INR 3,20,000").first()).toBeVisible();
  await expect(page.getByText(/outside policy/i).first()).toBeVisible();

  // Only a person ends it, and the record names them.
  await page.getByRole("button", { name: "Approve with a lower cap" }).click();
  await expect(page.getByRole("heading", { name: "Authorized. The cap is frozen." })).toBeVisible();
  await expect(page.getByText("Frozen by Finance owner (placeholder)").first()).toBeVisible();
  await expect(page.getByText("INR 3,60,000").first()).toBeVisible();

  // Later evidence lands against a cap that did not move.
  await page.getByRole("button", { name: /Let the September invoice arrive/ }).click();
  await expect(page.getByText("INR 4,72,000").first()).toBeVisible();
  await expect(page.getByText(/over cap/i).first()).toBeVisible();
  await expect(page.getByText("INR 3,60,000").first()).toBeVisible();

  // The exit is a real next action, not a dead end.
  await expect(page.getByRole("link", { name: "See the one-month pilot" })).toBeVisible();
  expect(failures).toEqual([]);
});

test("the demonstration's three decision branches produce three different frozen outcomes", async ({ page }) => {
  async function decide(choice: string) {
    await page.goto("/demo");
    await page.getByRole("button", { name: choice }).click();
  }

  await decide("Approve the full request");
  await expect(page.getByRole("heading", { name: "Authorized. The cap is frozen." })).toBeVisible();
  await expect(page.getByText("INR 4,80,000").first()).toBeVisible();

  await decide("Approve with a lower cap");
  await expect(page.getByRole("heading", { name: "Authorized. The cap is frozen." })).toBeVisible();
  await expect(page.getByText("INR 3,60,000").first()).toBeVisible();

  // A refusal creates no cap, so the record must end at the refusal. It may not
  // grow a reconciled step, a cap, or any comparison against one.
  await decide("Decline");
  await expect(page.getByRole("heading", { name: "Refused. No cap exists." })).toBeVisible();
  await expect(page.getByRole("button", { name: /Let the September invoice arrive/ })).toHaveCount(0);
  await expect(page.getByText(/Frozen by/)).toHaveCount(0);
  await expect(page.getByText(/over cap/i)).toHaveCount(0);
  await expect(page.getByText("INR 4,72,000")).toHaveCount(0);
});

test("the demonstration is read-only: it offers no control that writes and never calls the product API", async ({ page }) => {
  const productCalls: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/health")) {
      productCalls.push(`${request.method()} ${url.pathname}`);
    }
  });

  await page.goto("/demo");
  await page.getByRole("button", { name: "Approve with a lower cap" }).click();
  await page.getByRole("button", { name: /Let the September invoice arrive/ }).click();

  await expect(page.getByRole("button", { name: "Decide this proposal" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Link observed evidence" })).toHaveCount(0);
  expect(productCalls, `the demonstration must never touch the product API: ${productCalls.join(", ")}`).toEqual([]);

  await page.getByRole("button", { name: "Clear and choose again" }).click();
  await expect(page.getByText(/The record is unresolved/)).toBeVisible();
});

test("the demonstration is fully keyboard operable and free of serious accessibility defects", async ({ page }) => {
  await page.goto("/demo");

  await page.getByRole("button", { name: "Approve with a lower cap" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Frozen by Finance owner (placeholder)").first()).toBeVisible();

  await page.getByRole("button", { name: /Let the September invoice arrive/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/over cap/i).first()).toBeVisible();

  const result = await new AxeBuilder({ page }).analyze();
  const serious = result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  expect(serious, serious.map((violation) => `${violation.id}: ${violation.help}`).join("\n")).toEqual([]);
});

test("Journey 4 — the buyer path states one current offer and never advertises a retired one", async ({ page }) => {
  await page.goto("/pay");
  await expect(page.getByText(/14,999/)).toBeVisible();
  await expect(page.getByText(/private audit/i)).toHaveCount(0);

  await page.goto("/billing/return");
  await expect(page.getByText(/private audit/i)).toHaveCount(0);
  await expect(page.getByText(/assisted audit/i)).toHaveCount(0);
  await expect(page.getByText(/Settlement is not activation/)).toBeVisible();
});

test("public agent surfaces answer every real page instead of a Markdown 404", async ({ request }) => {
  for (const path of ["/", "/demo", "/pay", "/start", "/about", "/security"]) {
    const response = await request.get(path, { headers: { accept: "*/*" } });
    expect(response.status(), `${path} must be reachable by a non-HTML client`).toBe(200);
  }
});

function collectRuntimeFailures(page: Page) {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(`page: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (message.text().startsWith("Failed to load resource:")) return;
    failures.push(`console: ${message.text()}`);
  });
  return failures;
}
