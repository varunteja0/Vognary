import assert from "node:assert/strict";
import test from "node:test";
import { buildSourceCatalog, sourceAvailabilityLabels, sourceCatalogHasConnectAction, sourceCatalogIds } from "../src/lib/recovery/source-catalog";

test("the source catalog never offers Connect for reserved mailbox or accounting connectors", () => {
  const catalog = buildSourceCatalog({
    receiptInboxPubliclyAvailable: true,
    receiptInboxState: "READY",
    gmailOauthReady: true,
  });
  assert.deepEqual(catalog.map((entry) => entry.id), [...sourceCatalogIds]);
  assert.equal(catalog.find((entry) => entry.id === "BILLING_INBOX")?.availability, "CONNECTED");
  assert.equal(catalog.find((entry) => entry.id === "BILLING_INBOX")?.action, "MANAGE");
  assert.equal(sourceAvailabilityLabels.SETUP, "Needs setup");
  assert.equal(sourceAvailabilityLabels.CONNECTED, "Connected");
  for (const id of ["GOOGLE_WORKSPACE", "MICROSOFT_365", "ZOHO_BOOKS"] as const) {
    const entry = catalog.find((item) => item.id === id);
    assert.equal(entry?.availability, "PLANNED");
    assert.equal(entry?.action, "NONE");
    assert.doesNotMatch(entry?.summary ?? "", /\bConnect\b/);
  }
  assert.equal(sourceCatalogHasConnectAction(catalog), false);
  assert.match(catalog.find((entry) => entry.id === "GOOGLE_WORKSPACE")?.summary ?? "", /does not read Gmail/i);
});

test("an unavailable receipt inbox is listed honestly and still does not fake Gmail", () => {
  const catalog = buildSourceCatalog({
    receiptInboxPubliclyAvailable: false,
    receiptInboxState: null,
    gmailOauthReady: false,
  });
  assert.equal(catalog[0]?.id, "BILLING_INBOX");
  assert.equal(catalog[0]?.availability, "UNAVAILABLE");
  assert.equal(catalog[0]?.action, "NONE");
  assert.equal(sourceAvailabilityLabels[catalog[0].availability], "Not available yet");
  assert.equal(catalog.find((entry) => entry.id === "GOOGLE_WORKSPACE")?.availability, "PLANNED");
});
