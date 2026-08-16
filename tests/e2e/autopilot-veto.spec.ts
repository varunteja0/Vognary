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
