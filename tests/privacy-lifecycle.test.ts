import assert from "node:assert/strict";
import test from "node:test";

import {
  assertPrivacyExportIsMetadataOnly,
  buildPrivacyExportDocument,
  normalizePrivacyRequestInput,
  normalizeRetentionExecutionOptions,
  normalizeRetentionPolicyPatch,
  retentionPolicyDefaults,
} from "../src/lib/privacy-lifecycle";

test("retention policy patches merge with defaults and accept bounded integers", () => {
  assert.deepEqual(normalizeRetentionPolicyPatch({ productEventDays: 120 }), {
    ...retentionPolicyDefaults,
    productEventDays: 120,
  });
  assert.deepEqual(normalizeRetentionPolicyPatch({
    rawConnectorPayloadDays: 7,
    productEventDays: 365,
    operationalErrorDays: 90,
  }), {
    rawConnectorPayloadDays: 7,
    productEventDays: 365,
    operationalErrorDays: 90,
  });
});

test("retention policy patches reject ambiguous or unbounded input", () => {
  for (const input of [
    {},
    { unknown: 30 },
    { rawConnectorPayloadDays: null },
    { rawConnectorPayloadDays: "30" },
    { rawConnectorPayloadDays: 6 },
    { rawConnectorPayloadDays: 30.5 },
    { productEventDays: 366 },
    { operationalErrorDays: 91 },
  ]) {
    assert.throws(() => normalizeRetentionPolicyPatch(input));
  }
});

test("retention execution is dry-run-first and strictly bounded", () => {
  assert.deepEqual(normalizeRetentionExecutionOptions({}), {
    dryRun: true,
    workspaceId: null,
    afterWorkspaceId: null,
    workspaceLimit: 5,
    batchSize: 500,
  });
  assert.deepEqual(normalizeRetentionExecutionOptions({
    dryRun: false,
    workspaceId: "11111111-1111-4111-8111-111111111111",
    afterWorkspaceId: null,
    workspaceLimit: 1,
    batchSize: 100,
  }), {
    dryRun: false,
    workspaceId: "11111111-1111-4111-8111-111111111111",
    afterWorkspaceId: null,
    workspaceLimit: 1,
    batchSize: 100,
  });

  for (const input of [
    { dryRun: "false" },
    { workspaceId: "not-a-uuid" },
    { afterWorkspaceId: "not-a-uuid" },
    { dryRun: false, afterWorkspaceId: "11111111-1111-4111-8111-111111111111" },
    {
      workspaceId: "11111111-1111-4111-8111-111111111111",
      afterWorkspaceId: "22222222-2222-4222-8222-222222222222",
    },
    { workspaceLimit: 0 },
    { workspaceLimit: 11 },
    { batchSize: 99 },
    { batchSize: 2_001 },
    { extra: true },
  ]) {
    assert.throws(() => normalizeRetentionExecutionOptions(input));
  }

  assert.deepEqual(normalizeRetentionExecutionOptions({
    afterWorkspaceId: "22222222-2222-4222-8222-222222222222",
  }).afterWorkspaceId, "22222222-2222-4222-8222-222222222222");
});

test("privacy requests support only metadata export", () => {
  assert.deepEqual(normalizePrivacyRequestInput({ requestType: "access_export" }), {
    requestType: "access_export",
  });
  assert.throws(() => normalizePrivacyRequestInput({ requestType: "erasure" }));
  assert.throws(() => normalizePrivacyRequestInput({ requestType: "access_export", workspaceId: "client-controlled" }));
});

test("privacy export builder emits an allowlisted metadata-only document", () => {
  const document = buildPrivacyExportDocument({
    requestId: "request-1",
    generatedAt: "2026-07-11T00:00:00.000Z",
    scope: { userId: "user-1", workspaceId: "workspace-1" },
    account: {
      id: "user-1",
      email: "owner@example.test",
      displayName: "Owner",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    },
    workspace: {
      id: "workspace-1",
      name: "Example workspace",
      plan: "private_beta",
      workspaceType: "personal",
      role: "owner",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    },
    retentionPolicy: {
      ...retentionPolicyDefaults,
      usesWorkspaceOverride: false,
    },
    consents: [],
    connectedSources: [],
    dataSources: [],
    uploadedFiles: [],
    transactions: [],
    recurringLedger: [],
    evidence: [],
    decisions: [],
    recommendations: [],
    workspaceState: null,
    recovery: {
      workspaceState: null,
      versions: [],
      submissions: [],
      sources: [],
      commitments: [],
      evidence: [],
      commitmentEvidence: [],
      corrections: [],
      decisions: [],
      changes: [],
      inboundAliases: [],
      inboundEvents: [],
      standingMandates: [],
      actionCandidates: [],
      coveredWindows: [],
      feeLedger: [],
      billingYearAnchors: [],
      mandateEvents: [],
      classificationSnapshots: [],
      candidateEvents: [],
      vetoNotices: [],
      executionAttempts: [],
      executions: [],
      operatorActions: [],
      noticeDeliveryEvents: [],
      deadLetters: [],
      providerControls: [],
      connectedMandateCohort: [],
      sourceDisconnections: [],
    },
    productEvents: [],
    renewalAlertPreferences: [],
    renewalAlertDeliveries: [],
    weeklyDigestDeliveries: [],
    apiTokens: [],
    billingCheckouts: [],
    assistedAuditOrders: [],
    billingRefunds: [],
    entitlements: [],
    proofGraph: { nodes: [], edges: [], confidenceExplanations: [], ledgerEvents: [] },
    verifiedOutcomes: {
      actionCases: [],
      authorizations: [],
      caseEvents: [],
      verificationWindows: [],
      savingReceipts: [],
      successFeeInvoices: [],
    },
    auditHistory: [],
  });

  assert.equal(document.exportVersion, 2);
  assert.equal(document.generatedAt, "2026-07-11T00:00:00.000Z");
  assert.deepEqual(document.recovery.commitments, []);
  assert.ok(document.exclusions.some((entry) => entry.includes("Connector secrets")));
  assert.equal(assertPrivacyExportIsMetadataOnly(document), document);
});

test("privacy export guard detects sensitive snake-case and camelCase fields", () => {
  for (const field of ["accessToken", "refresh_token", "rawPayload", "payloadHash", "rawRow", "storageKey"]) {
    assert.throws(
      () => assertPrivacyExportIsMetadataOnly({ safe: { [field]: "must-not-escape" } }),
      new RegExp(field, "i"),
    );
  }

  assert.doesNotThrow(() => assertPrivacyExportIsMetadataOnly({ rawConnectorPayloadDays: 30 }));
});
