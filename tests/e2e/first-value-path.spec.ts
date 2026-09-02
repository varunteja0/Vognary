import { expect, test, type Page } from "@playwright/test";

test("the first-value path leads into the product without a cancel promise", async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await page.goto("/");

  const primary = page.locator("section").filter({ has: page.getByRole("heading", { name: "Commitment Control: freeze the cap before the obligation exists." }) })
    .getByRole("link", { name: "See a decision made", exact: true });
  await expect(primary).toBeVisible();
  await expect(primary).toHaveAttribute("href", "/demo");
  const evidence = page.locator("section").filter({ has: page.getByRole("heading", { name: "Commitment Control: freeze the cap before the obligation exists." }) })
    .getByRole("link", { name: "Cite your own bill", exact: true });
  await expect(evidence).toHaveAttribute("href", "/start");
  await evidence.click();
  await expect(page).toHaveURL(/\/start/);
  await expect(page.getByRole("heading", { name: "See the charge. Sign in to authorize." })).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Request a private audit" })).toHaveCount(0);
  expect(failures).toEqual([]);
});

test("the retired private-audit page permanently hands off to current onboarding", async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await page.goto("/private-audit");
  await expect(page).toHaveURL(/\/login\?next=(?:%2F|\/)app$/);
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByText(/INR 999|Assisted audit|Request private audit/i)).toHaveCount(0);
  expect(failures.filter((failure) => !failure.includes("Content Security Policy"))).toEqual([]);
});

function collectRuntimeFailures(page: Page) {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(`page: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (message.text().startsWith("Failed to load resource:")) return;
    failures.push(`console: ${message.text()}`);
  });
  page.on("requestfailed", (request) => {
    const error = request.failure()?.errorText ?? "failed";
    const url = new URL(request.url());
    if (error === "net::ERR_ABORTED" && request.method() === "GET" && url.searchParams.has("_rsc")) return;
    if (error === "net::ERR_ABORTED" && request.method() === "GET" && url.pathname === "/api/checkout") return;
    if (error === "net::ERR_ABORTED" && request.method() === "GET" && url.pathname === "/api/auth/session") return;
    failures.push(`request: ${request.url()} ${error}`);
  });
  page.on("response", (response) => {
    if (response.status() !== 404) return;
    const url = new URL(response.url());
    if (url.pathname === "/favicon.ico") return;
    failures.push(`404: ${url.pathname}${url.search}`);
  });
  return failures;
}
