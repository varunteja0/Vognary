import assert from "node:assert/strict";
import test from "node:test";
import { getConnectorById, getConnectorHonestyState } from "../src/lib/connectors";

test("inventory adapters never claim financial ledger coverage", () => {
  for (const id of ["github-copilot", "cloudflare-billing", "render-platform", "vercel-platform"]) {
    const connector = getConnectorById(id);
    assert.ok(connector, `${id} must exist`);
    assert.equal(connector.materialization, "source-health-only");
    assert.equal(getConnectorHonestyState(connector), "source-health-only");
    assert.match(connector.evidence, /no |does not/i);
  }
});

test("numeric provider cost evidence remains usage-only until commitment evidence exists", () => {
  const connector = getConnectorById("openai-costs");
  assert.ok(connector);
  assert.equal(connector.materialization, "usage-only");
  assert.equal(getConnectorHonestyState(connector), "usage-only");
});