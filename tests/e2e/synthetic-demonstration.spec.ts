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
  // Ten-second comprehension: category, the human-authority boundary, one command.
  await expect(page.getByRole("heading", { level: 1 })).toContainText("leave a line behind it");
  await expect(page.getByText("Commitment Control for India-first AI companies")).toBeVisible();

  // The Authority Field is the first-viewport subject, and the rejected hero
  // form and ticker are gone.
  const field = page.locator(".afield").first();
  await expect(field).toBeVisible();
  await expect(field).toHaveAttribute("data-stage", "EVIDENCE");
  await expect(page.locator(".landing-signal-track")).toHaveCount(0);
  await expect(page.locator("#control-index")).toHaveCount(0);
  await expect(page.locator("main form")).toHaveCount(0);

  const primary = page.getByRole("link", { name: "Walk a decision" }).first();
  await expect(primary).toBeVisible();
  await primary.click();
  await expect(page).toHaveURL(/\/demo$/);

  // The demonstration says what it is, on the first frame and every frame after.
  const stamp = page.getByTestId("synthetic-demonstration-label");
  await expect(stamp).toHaveText("Synthetic demonstration");

  // Proven evidence first: the only thing that is true before anyone asks.
  await expect(page.getByText("Proven by receipt")).toBeVisible();
  await expect(page.getByText("INR 3,050").first()).toBeVisible();

  // The request is an assumption, and it stays one while policy speaks.
  await page.getByRole("button", { name: "See the request" }).click();
  await expect(page.getByText("INR 4,200").first()).toBeVisible();
  await expect(page.getByText("Assumption").first()).toBeVisible();

  await page.getByRole("button", { name: "Apply the policy" }).click();
  await expect(page.getByText("Outside policy above here")).toBeVisible();
  await expect(stamp).toBeVisible();

  // Only a person ends it, and the field records the freeze.
  await page.getByRole("button", { name: "Take the decision" }).click();
  await page.getByRole("button", { name: "Approve with a lower cap" }).click();
  await expect(page.getByRole("heading", { name: "Authorized. The boundary is frozen." })).toBeVisible();
  await expect(page.getByText("Founder (placeholder),")).toBeVisible();
  await expect(field).toHaveAttribute("data-stage", "AUTHORIZED");

  // Later evidence lands against a boundary that did not move.
  await page.getByRole("button", { name: "Bring the later receipt" }).click();
  await expect(field).toHaveAttribute("data-stage", "OBSERVED");
  await expect(page.getByText("INR 4,720").first()).toBeVisible();
  await expect(page.getByText(/Over the boundary\./)).toBeVisible();
  await expect(page.getByText("INR 3,600").first()).toBeVisible();

  // The exit is a real next action, not a dead end.
  await expect(page.getByRole("link", { name: "Do this with your own bill" })).toBeVisible();
  expect(failures).toEqual([]);
});

test("the demonstration's three decision branches produce three different frozen outcomes", async ({ page }) => {
  const field = page.locator(".afield").first();

  async function decide(choice: string) {
    await page.goto("/demo");
    await page.getByRole("button", { name: "See the request" }).click();
    await page.getByRole("button", { name: "Apply the policy" }).click();
    await page.getByRole("button", { name: "Take the decision" }).click();
    await page.getByRole("button", { name: choice }).click();
  }

  await decide("Approve at the proposed amount");
  await expect(field).toHaveAttribute("data-stage", "AUTHORIZED");
  await expect(page.getByText("INR 4,200").first()).toBeVisible();

  await decide("Approve with a lower cap");
  await expect(field).toHaveAttribute("data-stage", "AUTHORIZED");
  await expect(page.getByText("INR 3,600").first()).toBeVisible();

  // A refusal creates no boundary, so the record must end at the refusal. It may
  // not grow a reconciled step, a cap, or any comparison against one.
  await decide("Decline");
  await expect(field).toHaveAttribute("data-stage", "REFUSED");
  await expect(page.getByRole("heading", { name: "Refused. No boundary exists." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Bring the later receipt" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "What actually arrived" })).toHaveCount(0);
  await expect(page.getByText(/Frozen cap/)).toHaveCount(0);
  await expect(page.getByText(/never moved/i)).toHaveCount(0);
  await expect(page.getByText(/Reconciled/)).toHaveCount(0);
  await expect(page.getByText(/Over the boundary/)).toHaveCount(0);
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
  await page.getByRole("button", { name: "See the request" }).click();
  await page.getByRole("button", { name: "Apply the policy" }).click();
  await page.getByRole("button", { name: "Take the decision" }).click();
  await page.getByRole("button", { name: "Approve with a lower cap" }).click();
  await page.getByRole("button", { name: "Bring the later receipt" }).click();

  await expect(page.getByRole("button", { name: "Decide this proposal" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Link observed evidence" })).toHaveCount(0);
  expect(productCalls, `the demonstration must never touch the product API: ${productCalls.join(", ")}`).toEqual([]);

  await page.getByRole("button", { name: "Start over" }).click();
  await expect(page.getByText("Proven by receipt")).toBeVisible();
  await expect(page.locator(".afield").first()).toHaveAttribute("data-stage", "EVIDENCE");
});

test("the demonstration is fully keyboard operable and free of serious accessibility defects", async ({ page }) => {
  await page.goto("/demo");

  for (const label of ["See the request", "Apply the policy", "Take the decision"]) {
    await page.getByRole("button", { name: label }).focus();
    await page.keyboard.press("Enter");
  }
  await page.getByRole("button", { name: "Approve with a lower cap" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Founder (placeholder),")).toBeVisible();

  await page.getByRole("button", { name: "Bring the later receipt" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/Over the boundary\./)).toBeVisible();

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
