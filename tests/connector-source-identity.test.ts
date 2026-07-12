import assert from "node:assert/strict";
import test from "node:test";
import {
  buildConnectorCoverageWindows,
  connectorEvidenceSourceName,
} from "../src/lib/connector-source-identity";

test("connector evidence sources stay account-specific", () => {
  const first = connectorEvidenceSourceName("gmail-readonly", "account-a");
  const second = connectorEvidenceSourceName("gmail-readonly", "account-b");
  assert.notEqual(first, second);
  assert.equal(first, "gmail-readonly-automatic-evidence-account-a.csv");
});

test("coverage windows use the exact evidence source and reject unusable intervals", () => {
  assert.deepEqual(buildConnectorCoverageWindows([
    {
      connectedAccountId: "account-a",
      connectorId: "gmail-readonly",
      status: "active",
      coverageStartAt: "2026-01-01T00:00:00.000Z",
      coverageEndAt: "2026-07-11T00:00:00.000Z",
    },
    {
      connectedAccountId: "account-b",
      connectorId: "gmail-readonly",
      status: "revoked",
      coverageStartAt: "2026-01-01T00:00:00.000Z",
      coverageEndAt: "2026-07-11T00:00:00.000Z",
    },
  ]), [{
    source: "gmail-readonly-automatic-evidence-account-a.csv",
    startDate: "2026-01-01",
    endDate: "2026-07-11",
  }]);
});