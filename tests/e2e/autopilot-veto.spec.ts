import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("the signed veto page is one action, does not mutate on GET, and stays accessible", async ({ page }) => {
  await page.goto("/autopilot/veto/example-token");
  await expect(page.getByRole("heading", { name: "Stop this Autopilot case" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Veto this case" })).toBeVisible();
  await expect(page.getByText(/cancelled, connected, saved, or paid/i)).toBeVisible();
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);
});

test("a transient veto failure keeps the original action available for a successful retry", async ({ page }) => {
  let attempts = 0;
  await page.route("**/api/autopilot/veto/example-token", async (route) => {
    attempts += 1;
    await route.fulfill({
      status: attempts === 1 ? 503 : 200,
      contentType: "text/html",
      body: attempts === 1
        ? "<!DOCTYPE html><html><body><h1>The veto could not be recorded just now</h1></body></html>"
        : "<!DOCTYPE html><html><body><h1>This Autopilot case is stopped</h1></body></html>",
    });
  });

  await page.goto("/autopilot/veto/example-token");
  await page.getByRole("button", { name: "Veto this case" }).click();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(/result could not be confirmed/i);

  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "This Autopilot case is stopped" })).toBeVisible();
  expect(attempts).toBe(2);
});

test("a lost veto response reports an unknown outcome and safely replays", async ({ page }) => {
  let attempts = 0;
  await page.route("**/api/autopilot/veto/example-token", async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await route.abort("connectionfailed");
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!DOCTYPE html><html><body><h1>This Autopilot case was already stopped</h1></body></html>",
    });
  });

  await page.goto("/autopilot/veto/example-token");
  await page.getByRole("button", { name: "Veto this case" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(/result could not be confirmed/i);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();

  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "This Autopilot case was already stopped" })).toBeVisible();
  expect(attempts).toBe(2);
});

test("public veto POST returns HTML confirmation and GET never mutates", async ({ request }) => {
  const token = "example-token-must-not-appear";
  const get = await request.get(`/api/autopilot/veto/${token}`);
  expect(get.status()).toBe(405);
  expect(get.headers()["content-type"]).toMatch(/text\/html/);
  const getBody = await get.text();
  expect(getBody).toMatch(/did not change any Autopilot case/);
  expect(getBody).not.toContain(token);
  expect(getBody).not.toMatch(/^\s*\{/);

  const post = await request.post(`/api/autopilot/veto/${token}`);
  expect(post.headers()["content-type"]).toMatch(/text\/html/);
  const postBody = await post.text();
  expect(postBody).toMatch(/<!DOCTYPE html>/);
  expect(postBody).toMatch(/<h1>/);
  expect(postBody).not.toContain(token);
  expect(postBody).not.toMatch(/^\s*\{/);
  expect(postBody).not.toMatch(/Error:|at Object\./);
});

test("the raw public veto navigation response never serializes its capability token", async ({ request }) => {
  const token = "raw-navigation-token-must-not-appear";
  const response = await request.get(`/autopilot/veto/${token}`);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/text\/html/);
  const body = await response.text();
  expect(body).toContain("Stop this Autopilot case");
  expect(body).not.toContain(token);
  expect(body).not.toContain("self.__next_f");
});
