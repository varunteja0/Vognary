import { expect, test } from "@playwright/test";
import { syntheticDeskRecords } from "../../src/lib/synthetic-control-desk";
import { formatExactMinorUnits } from "../../src/components/ui/money-value";

test("public record amounts retain their actual observed or assumed provenance", async ({ page }) => {
  await page.goto("/");
  for (const record of syntheticDeskRecords) {
    const { proposal, decision, reconciliations } = record.entry;
    const observed = reconciliations[0];
    const amount = observed ? observed.observedAmountMinor : decision?.approvedCapMinor ?? proposal.amountMinor;
    const currency = observed ? observed.observedCurrency : proposal.currency;
    const row = page.locator(".desk-row").filter({ hasText: proposal.merchant.replace(/ \(placeholder\)$/, "") });
    if (amount !== null && currency !== null) {
      await expect(row.locator(".money-amount")).toHaveText(formatExactMinorUnits(amount, currency));
    }
    await expect(row.locator(".money-provenance")).toHaveText(observed ? "Observed" : decision?.approvedCapMinor ? "Cap" : "Assumption");
    if (decision?.action === "DECLINE") await expect(row.locator(".desk-chip")).toHaveText("Declined");
  }
});
