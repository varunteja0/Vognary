import { expect, test } from "@playwright/test";

test("legacy product routes resolve to canonical launch destinations", async ({ page }) => {
  for (const legacyPath of ["/connect", "/integrations", "/sources"]) {
    await page.goto(legacyPath);
    await expect(page).toHaveURL(/\/login\?next=(?:%2F|\/)app$/);
  }

  for (const legacyPath of ["/guide", "/partners", "/beta-readiness", "/integration-model"]) {
    await page.goto(legacyPath);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Approve AI and cloud commitments before they become bills." })).toBeVisible();
  }

  await page.goto("/launch");
  await expect(page).toHaveURL(/\/login\?next=(?:%2F|\/)app$/);
});

test("direct brand and verification utilities are noindexed", async ({ page }) => {
  for (const utilityPath of ["/brand", "/verify"]) {
    await page.goto(utilityPath);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  }
});
