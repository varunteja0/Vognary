import { expect, test } from "@playwright/test";

test("an unauthenticated first session uses fixed synthetic bill review without accepting financial input", async ({ page }) => {
  const financialWrites: string[] = [];
  page.on("request", request => { if (request.method() === "POST" && /\/api\/(audit|ingest|receipt-image)/.test(request.url())) financialWrites.push(request.url()); });
  await page.goto("/start");
  await expect(page.getByRole("heading", { name: "Supplier bill review", exact: true })).toBeVisible();
  await expect(page.getByText("Fixed synthetic example / No provider reads")).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Close synthetic review" }).click();
  await expect(page.getByText("Synthetic review closed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Simulate a later bill amendment" }).click();
  await expect(page.getByText(/Revision 3 needs its own review/)).toBeVisible();
  await expect(page.getByText("Revision 2: review closed")).not.toBeVisible();
  await page.getByText("Synthetic review history", { exact: true }).click();
  await expect(page.getByText("Revision 2: review closed")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Bill review" })).toHaveAttribute("href", "/login?next=%2Fapp%3Fview%3DBILL_REVIEW");
  expect(financialWrites).toEqual([]);
  await page.reload();
  expect(await page.evaluate(() => sessionStorage.getItem("vognary.guest-audit-transfer.v1"))).toBeNull();
});

test("a reloaded guest can discard an older tab transfer and its workspace binding", async ({ page }) => {
  await page.goto("/start");
  await page.evaluate(() => {
    sessionStorage.setItem("vognary.guest-audit-transfer.v1", JSON.stringify({ receiptText: "Synthetic old receipt" }));
    sessionStorage.setItem("vognary.guest-audit-transfer-binding.v1", JSON.stringify({ workspaceId: "synthetic-workspace" }));
  });
  await page.reload();
  await page.getByRole("button", { name: "Discard tab evidence" }).click();
  const stored = await page.evaluate(() => [
    sessionStorage.getItem("vognary.guest-audit-transfer.v1"),
    sessionStorage.getItem("vognary.guest-audit-transfer-binding.v1"),
  ]);
  expect(stored).toEqual([null, null]);
  await expect(page.getByText("Tab evidence discarded. No receipt is queued for sign-in.")).toBeVisible();
});

test("discard reports denied storage honestly and can recover on retry", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/start");
  await page.evaluate(() => {
    sessionStorage.setItem("vognary.guest-audit-transfer.v1", "Synthetic old receipt");
    sessionStorage.setItem("vognary.guest-audit-transfer-binding.v1", "Synthetic binding");
    Object.defineProperty(sessionStorage, "removeItem", {
      configurable: true,
      value: () => { throw new DOMException("Synthetic storage denial", "SecurityError"); },
    });
  });
  await page.getByRole("button", { name: "Discard tab evidence" }).click();
  await expect(page.getByRole("status")).toContainText("Tab evidence could not be cleared");
  await expect(page.getByText("Tab evidence discarded. No receipt is queued for sign-in.")).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => sessionStorage.getItem("vognary.guest-audit-transfer.v1"))).toBe("Synthetic old receipt");
  await page.evaluate(() => Reflect.deleteProperty(sessionStorage, "removeItem"));
  await page.getByRole("button", { name: "Discard tab evidence" }).click();
  await expect(page.getByRole("status")).toHaveText("Tab evidence discarded. No receipt is queued for sign-in.");
  expect(await page.evaluate(() => [
    sessionStorage.getItem("vognary.guest-audit-transfer.v1"),
    sessionStorage.getItem("vognary.guest-audit-transfer-binding.v1"),
  ])).toEqual([null, null]);
});
