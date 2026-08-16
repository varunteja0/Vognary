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
