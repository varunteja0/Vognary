import { expect, test, type Page } from "@playwright/test";

test("the first-value path leads into the product without a cancel promise", async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await page.goto("/");

  const primary = page.locator("section").filter({ has: page.getByRole("heading", { name: "See what your company is about to pay. Decide before the card fires." }) })
    .getByRole("link", { name: "Review one bill", exact: true });
  await expect(primary).toBeVisible();
  await expect(primary).toHaveAttribute("href", "/start");
  await primary.click();
  await expect(page).toHaveURL(/\/start/);
  await expect(page.getByRole("heading", { name: "See what this bill means before the next charge." })).toBeVisible();
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
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  page.on("requestfailed", (request) => {
    const error = request.failure()?.errorText ?? "failed";
    const url = new URL(request.url());
    if (error === "net::ERR_ABORTED" && request.method() === "GET" && url.searchParams.has("_rsc")) return;
    if (error === "net::ERR_ABORTED" && request.method() === "GET" && url.pathname === "/api/checkout") return;
    if (error === "net::ERR_ABORTED" && request.method() === "GET" && url.pathname === "/api/auth/session") return;
    failures.push(`request: ${request.url()} ${error}`);
  });
  return failures;
}
