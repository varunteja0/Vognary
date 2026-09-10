import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import { Pool } from "pg";
import test, { after, before } from "node:test";
import { getDatabasePool } from "../../src/lib/server/database";
import {
  createCommitmentControlProposal, decideCommitmentControlProposal, getCommitmentControlBrief,
  putCommitmentControlPolicy, reconcileCommitmentControlProposal, getControlReconciliationCandidates,
} from "../../src/lib/server/commitment-control-store";
import { completeControlPolicyRequest, futureControlTestDate } from "../commitment-control-policy-fixture";
import { createZohoBooksClient } from "../../src/lib/server/zoho-books-client";
import { createZohoBooksService } from "../../src/lib/server/zoho-books-store";
import type { CreateControlProposalRequest } from "../../src/lib/commitment-control/contracts";
import { isCommitmentControlBriefDto, isControlReconciliationWriteDto } from "../../src/lib/commitment-control/contracts";
import { normalizeControlProviderBillRequest } from "../../src/lib/commitment-control/provider-bill-contracts";
import { submitRecoveryEvidence, getRecoveryEvidence, getRecoveryHome } from "../../src/lib/server/recovery-store";
import { loadRecoveryEvidenceSources, measureShadowGate, runShadowEvaluator, signStandingMandate } from "../../src/lib/server/recovery-autopilot-store";
import { queryAutopilotFunnel } from "../../src/lib/recovery/autopilot-funnel";
import { decryptSecret } from "../../src/lib/server/token-vault";
import { createAccessExportRequest, downloadAccessExport } from "../../src/lib/server/privacy-lifecycle-store";
import { RecoveryServiceError } from "../../src/lib/server/recovery-api";
import { createSessionCookie } from "../../src/lib/server/session";
import { PUT as policyHandler } from "../../src/app/api/workspaces/current/control/policy/route";
import { POST as proposalHandler } from "../../src/app/api/workspaces/current/control/proposals/route";
import { POST as decisionHandler } from "../../src/app/api/workspaces/current/control/proposals/[proposalId]/decision/route";
import { POST as reconciliationHandler } from "../../src/app/api/workspaces/current/control/proposals/[proposalId]/reconciliations/route";
import { GET as candidateHandler } from "../../src/app/api/workspaces/current/control/proposals/[proposalId]/reconciliation-candidates/route";
import { GET as briefHandler } from "../../src/app/api/workspaces/current/control/brief/route";
import { GET as sourceHandler, POST as sourceActionHandler } from "../../src/app/api/workspaces/current/sources/zoho-books/route";
import { readRecoveryBackupVerification, recoveryBackupVerificationMatches } from "../../scripts/lib/recovery-backup-verification.mjs";

process.env.COMMITMENT_CONTROL_PILOT_WORKSPACE_IDS = "*";
process.env.CONTROL_PROVIDER_BILL_WORKSPACE_IDS = "*";
process.env.ZOHO_BOOKS_PILOT_WORKSPACE_IDS = "*";
const database = { skip: !process.env.DATABASE_URL };
const originalDatabaseUrl = process.env.DATABASE_URL;
const fixtureDatabaseName = `vognary_a2_integrity_${randomUUID().replaceAll("-", "")}`;
const fixtureArtifactDirectory = join(".fallow/a2/backend", fixtureDatabaseName);
let fixtureAdmin: Pool | undefined;
let fixturePool: Pool | undefined;
let fixtureDatabaseCreated = false;

before(async () => {
  if (!originalDatabaseUrl) return;
  mkdirSync(fixtureArtifactDirectory, { recursive: true });
  const fixtureUrl = new URL(originalDatabaseUrl);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(fixtureUrl.hostname));
  fixtureAdmin = new Pool({ connectionString: originalDatabaseUrl, ssl: false });
  await fixtureAdmin.query(`create database "${fixtureDatabaseName}"`);
  fixtureDatabaseCreated = true;
  fixtureUrl.pathname = `/${fixtureDatabaseName}`;
  process.env.DATABASE_URL = fixtureUrl.href;
  execFileSync(process.execPath, ["scripts/apply-postgres-schema.mjs"], { env: process.env, stdio: "pipe" });
  fixturePool = getDatabasePool();
  assert.equal((await fixturePool.query("select current_database() as name")).rows[0].name, fixtureDatabaseName);
});

after(async () => {
  try {
    await fixturePool?.end();
    if (fixtureDatabaseCreated) await fixtureAdmin!.query(`drop database "${fixtureDatabaseName}"`);
  } finally {
    await fixtureAdmin?.end();
    if (originalDatabaseUrl) process.env.DATABASE_URL = originalDatabaseUrl;
  }
});

const authorizedAt = new Date("2026-09-01T00:00:00.000Z");
const capturedAt = new Date("2026-09-07T00:00:00.000Z");
const proposalRequest: CreateControlProposalRequest = {
  merchant: "Synthetic A2 supplier", purpose: "Synthetic single authorized charge", category: "SOFTWARE",
  amountMinor: "12345", currency: "INR", firstChargeDate: "2026-09-02", cadence: "ONE_TIME",
  existingCommitmentIds: [], amountBasis: "GROSS_BILLED_TOTAL_PER_CHARGE",
  intendedOutcome: { metric: "Synthetic completed tasks", targetDirection: "AT_LEAST", targetValue: "10", unit: "tasks", reviewOn: "2026-09-30" },
};
const initialBill = {
  bill_id: "200001", vendor_id: "300001", vendor_name: "Synthetic A2 supplier", bill_number: "SYNTHETIC-A2",
  date: "2026-09-02", currency_code: "INR", status: "open", total: 123.45, balance: 123.45,
  last_modified_time: "2026-09-02T00:00:00+0530",
};

async function withA2Fixture(run: (fixture: {
  pool: ReturnType<typeof getDatabasePool>; workspaceId: string; ownerId: string;
  service: ReturnType<typeof createZohoBooksService>;
  connect: (now?: Date) => Promise<void>;
  setBill: (bill: typeof initialBill) => void;
  setBills: (bills: Array<typeof initialBill>) => void;
  authorize: (request?: CreateControlProposalRequest, now?: Date, decisionActorUserId?: string) => Promise<{
    proposal: Awaited<ReturnType<typeof createCommitmentControlProposal>>;
    decision: Awaited<ReturnType<typeof decideCommitmentControlProposal>>;
  }>;
}) => Promise<void>) {
  const pool = getDatabasePool();
  const workspaceId = randomUUID();
  const ownerId = randomUUID();
  await pool.query("insert into users(id,email) values ($1,$2)", [ownerId, `synthetic-a2-${ownerId}@example.test`]);
  await pool.query("insert into workspaces(id,owner_user_id,name) values ($1,$2,'Synthetic A2 workspace')", [workspaceId, ownerId]);
  await pool.query("insert into workspace_members(workspace_id,user_id,role) values ($1,$2,'owner')", [workspaceId, ownerId]);
  let currentBills = [{ ...initialBill }];
  const provider = createZohoBooksClient({ clientId: "synthetic", clientSecret: "synthetic", redirectUri: "http://127.0.0.1:57610/callback" }, async request => {
    const url = new URL(request);
    if (url.pathname === "/oauth/v2/token") return Response.json({ access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_in: 3600, api_domain: "https://www.zohoapis.in" });
    if (url.pathname === "/oauth/v2/token/revoke") return Response.json({ status: "success" });
    if (url.pathname.endsWith("/organizations")) return Response.json({ code: 0, organizations: [{ organization_id: "100001", name: "Synthetic A2 organization", currency_code: "INR", is_org_active: true }] });
    const page = Number(url.searchParams.get("page") ?? "1");
    const pageSize = Number(url.searchParams.get("per_page") ?? "200");
    return Response.json({ code: 0, bills: currentBills.slice((page - 1) * pageSize, page * pageSize), page_context: { page, has_more_page: page * pageSize < currentBills.length } });
  });
  const service = createZohoBooksService({ pool, client: provider, workspaceIds: [workspaceId] });
  const connect = async (now = capturedAt) => {
    const authorization = await service.begin(workspaceId, ownerId, now);
    await service.complete(workspaceId, ownerId, new URL(authorization.authorizationUrl).searchParams.get("state")!, "synthetic-code", now);
    const state = await service.read(workspaceId, ownerId);
    await service.select(workspaceId, ownerId, "100001", state.connection!.revision, now);
    await service.runDue(now);
  };
  const authorize = async (request = proposalRequest, now = authorizedAt, decisionActorUserId: string = ownerId) => {
    const before = await getCommitmentControlBrief({ workspaceId, actorUserId: ownerId });
    const policy = await putCommitmentControlPolicy({ workspaceId, actorUserId: ownerId, expectedVersion: before.workspaceVersion, idempotencyKey: randomUUID(), request: completeControlPolicyRequest(), now });
    const proposal = await createCommitmentControlProposal({ workspaceId, actorUserId: ownerId, expectedVersion: policy.workspaceVersion, idempotencyKey: randomUUID(), request, now });
    const decision = await decideCommitmentControlProposal({ workspaceId, actorUserId: decisionActorUserId, proposalId: proposal.data.proposal.id, expectedVersion: proposal.workspaceVersion, idempotencyKey: randomUUID(), request: { action: "APPROVE", authorizationExpiresOn: "2026-09-20" }, now });
    return { proposal, decision };
  };
  try {
    await run({ pool, workspaceId, ownerId, service, connect, setBill: bill => { currentBills = [bill]; }, setBills: bills => { currentBills = bills; }, authorize });
  } finally {
    await pool.query("delete from workspaces where id=$1", [workspaceId]);
    await pool.query("delete from users where id=$1", [ownerId]);
  }
}

test("A2 freezes explicit gross basis through proposal, evaluation, decision and reload without legacy backfill", database, async () => {
  await withA2Fixture(async ({ workspaceId, ownerId, authorize }) => {
    const explicit = await authorize();
    assert.equal((explicit.proposal.data.proposal as Record<string, unknown>).amountBasis, "GROSS_BILLED_TOTAL_PER_CHARGE");
    assert.equal((explicit.proposal.data.evaluation as Record<string, unknown>).amountBasis, "GROSS_BILLED_TOTAL_PER_CHARGE");
    assert.equal((explicit.decision.data.decision as Record<string, unknown>).amountBasis, "GROSS_BILLED_TOTAL_PER_CHARGE");
    const legacyRequest = { ...proposalRequest };
    delete legacyRequest.amountBasis;
    const legacy = await authorize(legacyRequest);
    const brief = await getCommitmentControlBrief({ workspaceId, actorUserId: ownerId });
    const reloaded = brief.data.proposals.find(entry => entry.proposal.id === explicit.proposal.data.proposal.id)!;
    assert.equal((reloaded.decision as unknown as Record<string, unknown>).amountBasis, "GROSS_BILLED_TOTAL_PER_CHARGE");
    const legacyReloaded = brief.data.proposals.find(entry => entry.proposal.id === legacy.proposal.data.proposal.id)!;
    assert.equal((legacyReloaded.proposal as Record<string, unknown>).amountBasis ?? null, null);
    assert.equal((legacyReloaded.decision as unknown as Record<string, unknown>).amountBasis ?? null, null);
  });
});

test("new gross approvals require a positive non-null cap at the direct SQL boundary", database, async suite => {
  for (const action of ["APPROVE", "APPROVE_WITH_CAP"]) await suite.test(action, async () => {
    await withA2Fixture(async fixture => {
      const { decision } = await fixture.authorize();
      const pending = await createCommitmentControlProposal({ workspaceId: fixture.workspaceId, actorUserId: fixture.ownerId,
        expectedVersion: decision.workspaceVersion, idempotencyKey: randomUUID(), request: proposalRequest, now: authorizedAt });
      const decisionsBefore = (await fixture.pool.query("select to_jsonb(decision) as record from commitment_control_decisions decision where workspace_id=$1", [fixture.workspaceId])).rows;
      const before = await a2WriteState(fixture);
      await assert.rejects(() => fixture.pool.query(`insert into commitment_control_decisions
        select (jsonb_populate_record(null::commitment_control_decisions,to_jsonb(decision)
          || jsonb_build_object('id',$2::text,'proposal_id',$3::text,'evaluation_id',$4::text,'action',$5::text,'approved_cap_minor',null))).*
        from commitment_control_decisions decision where id=$1`,
        [decision.data.decision.id, randomUUID(), pending.data.proposal.id, pending.data.evaluation.id, action]),
        (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "23514"));
      assert.deepEqual((await fixture.pool.query("select to_jsonb(decision) as record from commitment_control_decisions decision where workspace_id=$1", [fixture.workspaceId])).rows, decisionsBefore);
      assert.deepEqual(await a2WriteState(fixture), before);
    });
  });
});

test("future Books captures bind immutable original grants and organizations; reconsent captures anew", database, async () => {
  await withA2Fixture(async ({ pool, workspaceId, ownerId, service, connect }) => {
    await connect();
    const original = (await pool.query("select to_jsonb(snapshot) as snapshot from zoho_books_snapshots snapshot where workspace_id=$1", [workspaceId])).rows[0].snapshot;
    assert.ok(original.grant_id, "A future capture must reference its original immutable grant.");
    assert.equal(original.organization_id, "100001");
    const grant = (await pool.query("select * from zoho_books_grants where id=$1", [original.grant_id])).rows[0];
    assert.equal(grant.workspace_id, workspaceId);
    assert.equal(grant.connection_id, original.connection_id);
    assert.equal(grant.authorized_by_user_id, ownerId);
    assert.deepEqual(grant.scopes, ["ZohoBooks.settings.READ", "ZohoBooks.bills.READ"]);
    assert.equal(grant.authorized_at.toISOString(), capturedAt.toISOString());
    await assert.rejects(() => pool.query("update zoho_books_grants set scopes='{}' where id=$1", [grant.id]), /immutable/i);
    await assert.rejects(() => pool.query("update zoho_books_snapshots set grant_id=null,organization_id=null where sequence=$1", [original.sequence]), /immutable/i);
    await assert.rejects(() => pool.query("update zoho_books_connections set organization_id='999999' where id=$1", [original.connection_id]), /organization|immutable/i);
    await assert.rejects(() => pool.query("insert into zoho_books_snapshots(connection_id,workspace_id,bill_id,fingerprint,bill,change_kind,observed_at,grant_id,organization_id) select connection_id,workspace_id,bill_id,$2,bill,change_kind,observed_at,grant_id,'999999' from zoho_books_snapshots where sequence=$1", [original.sequence, randomUUID()]), /grant|organization/i);
    await connect();
    const current = (await service.read(workspaceId, ownerId, { view: "ALL" })).items[0];
    assert.notEqual(current.sequence, String(original.sequence), "Unchanged bills require a new capture under the new grant.");
    const previous = (await pool.query("select grant_id from zoho_books_snapshots where sequence=$1", [original.sequence])).rows[0];
    assert.equal(previous.grant_id, original.grant_id);
    assert.equal((await pool.query("select id from zoho_books_grants where workspace_id=$1", [workspaceId])).rowCount, 2);
  });
});

test("human confirmation atomically admits a detached provider bill, compares it, and replays the original result", database, async () => {
  await withA2Fixture(async ({ pool, workspaceId, ownerId, service, connect, authorize }) => {
    const { proposal, decision } = await authorize();
    await connect();
    const source = await service.read(workspaceId, ownerId, { view: "ALL" });
    const request = normalizeControlProviderBillRequest({
      source: "ZOHO_BOOKS", connectionId: source.connection!.id, organizationId: "100001", billId: "200001",
      sourceSequence: source.items[0].sequence, expectedLatestSequence: source.items[0].sequence,
      expectedSourceVersion: source.connection!.revision, wholeCharge: "USER_CONFIRMED_SAME_CHARGE",
      retentionNotice: "control-provider-bill-retention-v1",
    });
    const input = { workspaceId, actorUserId: ownerId, proposalId: proposal.data.proposal.id,
      expectedVersion: decision.workspaceVersion, idempotencyKey: randomUUID(), request, now: capturedAt };
    const result = await reconcileCommitmentControlProposal(input);
    assert.equal(result.workspaceVersion, decision.workspaceVersion + 1);
    assert.equal(result.data.reconciliation.verdict, "MATCHED");
    assert.equal((result.data.reconciliation as Record<string, unknown>).comparisonKind, "BILLED_AMOUNT_COMPARISON");
    assert.equal(isControlReconciliationWriteDto(result.data), true);
    const evidence = (await pool.query("select * from recovery_evidence where workspace_id=$1", [workspaceId])).rows;
    assert.equal(evidence.length, 1);
    assert.equal(evidence[0].evidence_kind, "PROVIDER_BILL");
    assert.equal(evidence[0].evidence_basis, "PROVIDER_BILL_TOTAL");
    assert.equal(evidence[0].observed_at, null);
    assert.equal(evidence[0].amount_minor, "12345");
    assert.equal(evidence[0].cadence_hint, null);
    assert.equal(evidence[0].next_expected_date, null);
    await assert.rejects(() => getRecoveryEvidence({ workspaceId, actorUserId: ownerId, evidenceId: evidence[0].id }),
      (error: unknown) => error instanceof RecoveryServiceError && error.code === "INVALID_EVIDENCE");
    assert.equal((await pool.query("select id from recovery_commitments where workspace_id=$1", [workspaceId])).rowCount, 0);
    const lineage = (await pool.query("select * from recovery_provider_bill_links where workspace_id=$1", [workspaceId])).rows[0];
    assert.equal(lineage.source_sequence, request.sourceSequence);
    assert.equal(lineage.source_observed_at.toISOString(), capturedAt.toISOString());
    assert.equal(lineage.organization_id, "100001");
    assert.equal(lineage.retention_notice, request.retentionNotice);
    const retry = await reconcileCommitmentControlProposal(input);
    assert.equal(retry.replayed, true);
    assert.deepEqual(retry.data, result.data);
    await assert.rejects(() => reconcileCommitmentControlProposal({ ...input, request: { ...request, billId: "999999" } }), /Idempotency|different|conflict/i);
    await assert.rejects(() => reconcileCommitmentControlProposal({ ...input, idempotencyKey: randomUUID(), expectedVersion: result.workspaceVersion }), /already|conflict|duplicate/i);
    await assert.rejects(() => reconcileCommitmentControlProposal({ ...input, idempotencyKey: randomUUID(), expectedVersion: result.workspaceVersion, request: { evidenceId: evidence[0].id } }), /observed|provider|charge/i);
    const brief = await getCommitmentControlBrief({ workspaceId, actorUserId: ownerId });
    assert.equal(isCommitmentControlBriefDto(brief.data), true);
    assert.equal(brief.data.proposals[0].reconciliations.length, 1);
    assert.equal(brief.data.proposals[0].reconciliations[0].observedAmountMinor, "12345");
  });
});

async function prepareA2(fixture: Parameters<Parameters<typeof withA2Fixture>[0]>[0], decisionActorUserId?: string) {
  const { workspaceId, ownerId, service, connect, authorize } = fixture;
  const { proposal, decision } = await authorize(proposalRequest, authorizedAt, decisionActorUserId);
  await connect();
  const state = await service.read(workspaceId, ownerId, { view: "ALL" });
  const request = normalizeControlProviderBillRequest({ source: "ZOHO_BOOKS", connectionId: state.connection!.id,
    organizationId: "100001", billId: "200001", sourceSequence: state.items[0].sequence,
    expectedLatestSequence: state.items[0].sequence, expectedSourceVersion: state.connection!.revision,
    wholeCharge: "USER_CONFIRMED_SAME_CHARGE", retentionNotice: "control-provider-bill-retention-v1" });
  const input = { workspaceId, actorUserId: ownerId, proposalId: proposal.data.proposal.id,
    expectedVersion: decision.workspaceVersion, idempotencyKey: randomUUID(), request, now: capturedAt };
  return input;
}

async function admitA2(fixture: Parameters<Parameters<typeof withA2Fixture>[0]>[0]) {
  const input = await prepareA2(fixture);
  return { input, result: await reconcileCommitmentControlProposal(input) };
}

async function a2WriteState(fixture: Parameters<Parameters<typeof withA2Fixture>[0]>[0]) {
  const counts = await Promise.all([
    "recovery_submissions", "recovery_sources", "recovery_evidence", "recovery_provider_bill_links",
    "commitment_control_reconciliations", "recovery_idempotency_keys", "audit_log",
  ].map(async table => [table, (await fixture.pool.query(`select count(*)::integer as count from ${table} where workspace_id=$1`, [fixture.workspaceId])).rows[0].count]));
  return { ...Object.fromEntries(counts), workspaceVersion: (await fixture.pool.query("select version::text from recovery_workspace_states where workspace_id=$1", [fixture.workspaceId])).rows[0].version };
}

async function withA2Admin(fixture: Parameters<Parameters<typeof withA2Fixture>[0]>[0], run: (adminId: string) => Promise<void>) {
  const adminId = randomUUID();
  await fixture.pool.query("insert into users(id,email) values($1,$2)", [adminId, `synthetic-a2-admin-${adminId}@example.test`]);
  await fixture.pool.query("insert into workspace_members(workspace_id,user_id,role) values($1,$2,'admin')", [fixture.workspaceId, adminId]);
  try { await run(adminId); }
  finally {
    await fixture.pool.query("delete from workspace_members where workspace_id=$1 and user_id=$2", [fixture.workspaceId, adminId]);
    await fixture.pool.query("delete from users where id=$1", [adminId]);
  }
}

async function waitForA2DatabaseCondition(condition: () => Promise<boolean>, message: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await yieldToEventLoop();
  }
  assert.fail(message);
}

test("same-day pre-approval capture refuses new admission and candidates with zero financial writes", database, async () => {
  await withA2Fixture(async fixture => {
    const observedAt = new Date("2026-09-07T08:18:00.000Z");
    const decidedAt = new Date("2026-09-07T08:30:00.000Z");
    const confirmedAt = new Date("2026-09-07T08:35:00.000Z");
    fixture.setBill({ ...initialBill, date: "2026-09-07", last_modified_time: "2026-09-07T08:17:00.000Z" });
    await fixture.connect(observedAt);
    const { proposal, decision } = await fixture.authorize({ ...proposalRequest, firstChargeDate: "2026-09-07" }, decidedAt);
    const { workspaceId, ownerId } = fixture;
    const source = await fixture.service.read(workspaceId, ownerId, { view: "ALL" });
    const request = normalizeControlProviderBillRequest({ source: "ZOHO_BOOKS", connectionId: source.connection!.id,
      organizationId: "100001", billId: "200001", sourceSequence: source.items[0].sequence,
      expectedLatestSequence: source.items[0].sequence, expectedSourceVersion: source.connection!.revision,
      wholeCharge: "USER_CONFIRMED_SAME_CHARGE", retentionNotice: "control-provider-bill-retention-v1" });
    const before = await a2WriteState(fixture);
    const candidates = await getControlReconciliationCandidates({ workspaceId, actorUserId: ownerId,
      proposalId: proposal.data.proposal.id, source: "ZOHO_BOOKS", now: confirmedAt });
    assert.equal(candidates.data.source, "ZOHO_BOOKS");
    if (candidates.data.source !== "ZOHO_BOOKS") assert.fail("Expected provider-bill candidates.");
    assert.equal(candidates.data.candidates[0].canSelect, false);
    assert.match(candidates.data.candidates[0].selectionReasons.join(" "), /source.*observ|predate/i);
    await assert.rejects(() => reconcileCommitmentControlProposal({ workspaceId, actorUserId: ownerId,
      proposalId: proposal.data.proposal.id, expectedVersion: decision.workspaceVersion, idempotencyKey: randomUUID(), request, now: confirmedAt }),
      (error: unknown) => error instanceof RecoveryServiceError && error.code === "INVALID_EVIDENCE" && /source.*observ|predate/i.test(error.message));
    assert.deepEqual(await a2WriteState(fixture), before);
    assert.equal(before.recovery_evidence, 0);
  });
});

test("same-day pre-approval capture refuses direct SQL comparison while original replay remains legitimate", database, async () => {
  await withA2Fixture(async fixture => {
    const earlyDecisionAt = new Date("2026-09-07T08:00:00.000Z");
    const observedAt = new Date("2026-09-07T08:18:00.000Z");
    const lateDecisionAt = new Date("2026-09-07T08:30:00.000Z");
    const confirmedAt = new Date("2026-09-07T08:35:00.000Z");
    const early = await fixture.authorize({ ...proposalRequest, firstChargeDate: "2026-09-07" }, earlyDecisionAt);
    fixture.setBill({ ...initialBill, date: "2026-09-07", last_modified_time: "2026-09-07T08:17:00.000Z" });
    await fixture.connect(observedAt);
    const source = await fixture.service.read(fixture.workspaceId, fixture.ownerId, { view: "ALL" });
    const request = normalizeControlProviderBillRequest({ source: "ZOHO_BOOKS", connectionId: source.connection!.id,
      organizationId: "100001", billId: "200001", sourceSequence: source.items[0].sequence,
      expectedLatestSequence: source.items[0].sequence, expectedSourceVersion: source.connection!.revision,
      wholeCharge: "USER_CONFIRMED_SAME_CHARGE", retentionNotice: "control-provider-bill-retention-v1" });
    const input = { workspaceId: fixture.workspaceId, actorUserId: fixture.ownerId, proposalId: early.proposal.data.proposal.id,
      expectedVersion: early.decision.workspaceVersion, idempotencyKey: randomUUID(), request, now: new Date("2026-09-07T08:19:00.000Z") };
    const original = await reconcileCommitmentControlProposal(input);
    const late = await fixture.authorize({ ...proposalRequest, firstChargeDate: "2026-09-07" }, lateDecisionAt);
    const before = await a2WriteState(fixture);
    await assert.rejects(() => fixture.pool.query(`insert into commitment_control_reconciliations
      select (jsonb_populate_record(null::commitment_control_reconciliations,to_jsonb(comparison)
        || jsonb_build_object('id',$2::text,'proposal_id',$3::text,'decision_id',$4::text,'reconciled_at',$5::timestamptz))).*
      from commitment_control_reconciliations comparison where id=$1`,
      [original.data.reconciliation.id, randomUUID(), late.proposal.data.proposal.id, late.decision.data.decision.id, confirmedAt]),
      (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "23514"));
    assert.deepEqual(await a2WriteState(fixture), before);
    assert.deepEqual((await reconcileCommitmentControlProposal({ ...input, now: confirmedAt })).data, original.data);
    assert.equal((await fixture.pool.query("select observed_at from recovery_evidence where workspace_id=$1", [fixture.workspaceId])).rows[0].observed_at, null);
  });
});

test("a soft-deleted original grant authorizer cannot authorize admission by another live admin", database, async () => {
  await withA2Fixture(async fixture => withA2Admin(fixture, async adminId => {
    const input = { ...await prepareA2(fixture, adminId), actorUserId: adminId };
    await fixture.pool.query("update users set deleted_at=$2 where id=$1", [fixture.ownerId, capturedAt]);
    const before = await a2WriteState(fixture);
    await assert.rejects(() => reconcileCommitmentControlProposal(input),
      (error: unknown) => error instanceof RecoveryServiceError && error.code === "INVALID_EVIDENCE" && /CONSENT_NOT_CURRENT/.test(error.message));
    assert.deepEqual(await a2WriteState(fixture), before);
    const candidates = await getControlReconciliationCandidates({ workspaceId: fixture.workspaceId, actorUserId: adminId,
      proposalId: input.proposalId, source: "ZOHO_BOOKS", now: capturedAt });
    if (candidates.data.source !== "ZOHO_BOOKS") assert.fail("Expected provider-bill candidates.");
    assert.equal(candidates.data.candidates[0].canSelect, false);
    assert.ok(candidates.data.candidates[0].selectionReasons.includes("CONSENT_NOT_CURRENT"));
  }));
});

test("direct SQL requires a live original grant authorizer but original replay survives deletion and source erasure", database, async () => {
  await withA2Fixture(async fixture => withA2Admin(fixture, async adminId => {
    const input = { ...await prepareA2(fixture, adminId), actorUserId: adminId };
    const original = await reconcileCommitmentControlProposal(input);
    const next = await fixture.authorize(proposalRequest, authorizedAt, adminId);
    await fixture.pool.query("update users set deleted_at=$2 where id=$1", [fixture.ownerId, capturedAt]);
    const before = await a2WriteState(fixture);
    await assert.rejects(() => fixture.pool.query(`insert into commitment_control_reconciliations
      select (jsonb_populate_record(null::commitment_control_reconciliations,to_jsonb(comparison)
        || jsonb_build_object('id',$2::text,'proposal_id',$3::text,'decision_id',$4::text))).*
      from commitment_control_reconciliations comparison where id=$1`,
      [original.data.reconciliation.id, randomUUID(), next.proposal.data.proposal.id, next.decision.data.decision.id]),
      (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "23514"));
    assert.deepEqual(await a2WriteState(fixture), before);
    assert.deepEqual((await reconcileCommitmentControlProposal(input)).data, original.data);
    let source = await fixture.service.read(fixture.workspaceId, adminId);
    await fixture.service.disconnect(fixture.workspaceId, adminId, source.connection!.revision);
    assert.deepEqual((await reconcileCommitmentControlProposal(input)).data, original.data);
    source = await fixture.service.read(fixture.workspaceId, adminId);
    await fixture.service.erase(fixture.workspaceId, adminId, source.connection!.revision,
      { noticeVersion: "control-provider-bill-retention-v1", retainAdmitted: true, retainedAdmissionCount: 1 });
    assert.deepEqual((await reconcileCommitmentControlProposal(input)).data, original.data);
  }));
});

test("original grant authorizer demotion and deletion serialize through the last-check commit barrier", database, async suite => {
  for (const mutation of ["demotion", "soft-deletion"]) await suite.test(mutation, async () => {
    await withA2Fixture(async fixture => withA2Admin(fixture, async adminId => {
      const input = { ...await prepareA2(fixture, adminId), actorUserId: adminId };
      const { pool, workspaceId, ownerId } = fixture;
      const barrier = await pool.connect();
      const mutator = await pool.connect();
      let confirmation: ReturnType<typeof reconcileCommitmentControlProposal> | undefined;
      let authorityMutation: Promise<unknown> | undefined;
      let mutationFinished = false;
      try {
        const barrierPid = (await barrier.query("select pg_backend_pid() as pid")).rows[0].pid as number;
        const mutatorPid = (await mutator.query("select pg_backend_pid() as pid")).rows[0].pid as number;
        await barrier.query("select pg_advisory_lock(hashtextextended($1,77))", [workspaceId]);
        await pool.query(`create function a2_authorizer_commit_barrier() returns trigger language plpgsql as $$ begin
          if new.workspace_id='${workspaceId}'::uuid then perform pg_advisory_xact_lock(hashtextextended('${workspaceId}',77)); end if;
          return new; end; $$`);
        await pool.query("create trigger a2_authorizer_commit_barrier before insert on audit_log for each row execute function a2_authorizer_commit_barrier()");
        confirmation = reconcileCommitmentControlProposal(input);
        void confirmation.catch(() => undefined);
        let confirmationPid = 0;
        await waitForA2DatabaseCondition(async () => {
          const paused = await pool.query("select pid from pg_stat_activity where datname=current_database() and wait_event='advisory' and $1::integer=any(pg_blocking_pids(pid))", [barrierPid]);
          confirmationPid = paused.rows[0]?.pid ?? 0;
          return confirmationPid !== 0;
        }, "Confirmation must reach the post-validation, pre-commit database barrier.");
        await mutator.query("begin");
        authorityMutation = (async () => {
          if (mutation === "demotion") await mutator.query("update workspace_members set role='viewer' where workspace_id=$1 and user_id=$2", [workspaceId, ownerId]);
          else await mutator.query("update users set deleted_at=$2 where id=$1", [ownerId, capturedAt]);
          await mutator.query("commit");
        })();
        void authorityMutation.then(() => { mutationFinished = true; }, () => { mutationFinished = true; });
        await waitForA2DatabaseCondition(async () => mutationFinished
          || (await pool.query("select $2::integer=any(pg_blocking_pids($1::integer)) as blocked", [mutatorPid, confirmationPid])).rows[0].blocked,
        "Authority mutation must either finish or wait on the paused confirmation transaction.");
        assert.equal(mutationFinished, false, `${mutation} must not commit between the last authority check and the admission commit.`);
        assert.equal((await pool.query("select $2::integer=any(pg_blocking_pids($1::integer)) as blocked", [mutatorPid, confirmationPid])).rows[0].blocked, true);
      } finally {
        await barrier.query("select pg_advisory_unlock(hashtextextended($1,77))", [workspaceId]);
        await Promise.allSettled([confirmation, authorityMutation]);
        await mutator.query("rollback");
        barrier.release();
        mutator.release();
        await pool.query("drop trigger if exists a2_authorizer_commit_barrier on audit_log");
        await pool.query("drop function if exists a2_authorizer_commit_barrier()");
      }
      assert.ok(confirmation);
      const original = await confirmation;
      await authorityMutation;
      assert.equal(original.data.reconciliation.verdict, "MATCHED");
      assert.deepEqual((await reconcileCommitmentControlProposal(input)).data, original.data);
      const after = await a2WriteState(fixture);
      await assert.rejects(() => reconcileCommitmentControlProposal({ ...input, expectedVersion: original.workspaceVersion, idempotencyKey: randomUUID() }),
        (error: unknown) => error instanceof RecoveryServiceError && error.code === "INVALID_EVIDENCE");
      assert.deepEqual(await a2WriteState(fixture), after);
      assert.equal(after.recovery_evidence, 1);
      assert.equal(after.commitment_control_reconciliations, 1);
    }));
  });
});

test("admitted bills use canonical Recovery encryption and retain no invented raw receipt or balance", database, async () => {
  await withA2Fixture(async fixture => {
    await admitA2(fixture);
    const source = (await fixture.pool.query("select * from recovery_sources where workspace_id=$1", [fixture.workspaceId])).rows[0];
    assert.equal(source.source_type, "ZOHO_BOOKS");
    const minimized = JSON.parse(decryptSecret(source.raw_evidence, `vognary-recovery-evidence:${fixture.workspaceId}:${source.id}`));
    assert.equal(minimized.totalMinor, "12345");
    assert.equal(minimized.sourceTotal, "123.45");
    assert.equal(minimized.basis, "PROVIDER_BILL_TOTAL");
    assert.equal(minimized.balanceMinor, undefined);
    assert.equal(minimized.text, undefined);
    assert.equal(minimized.vendorId, undefined);
  });
});

test("later ordinary receipt and CSV ingestion never treats admitted bills as recurrence, graph coverage or autopilot evidence", database, async () => {
  await withA2Fixture(async fixture => {
    const { result } = await admitA2(fixture);
    const { pool, workspaceId, ownerId } = fixture;
    const receipt = await submitRecoveryEvidence({ workspaceId, actorUserId: ownerId, expectedVersion: result.workspaceVersion,
      idempotencyKey: randomUUID(), now: capturedAt,
      request: { kind: "RECEIPT_PASTE", receipts: [{ clientRef: "synthetic-receipt", text: "Synthetic unrelated software invoice paid INR 100.00 on 3 September 2026. Monthly subscription." }] } });
    await submitRecoveryEvidence({ workspaceId, actorUserId: ownerId, expectedVersion: receipt.workspaceVersion,
      idempotencyKey: randomUUID(), now: capturedAt,
      request: { kind: "CSV_IMPORT", sources: [{ clientRef: "synthetic-csv", name: "synthetic.csv", text: "Date,Description,Amount,Currency\n2026-08-03,Synthetic CSV service,-45.00,INR\n2026-09-03,Synthetic CSV service,-45.00,INR" }] } });
    const provider = (await pool.query("select id,source_id from recovery_evidence where workspace_id=$1 and evidence_kind='PROVIDER_BILL'", [workspaceId])).rows[0];
    assert.equal((await pool.query("select * from recovery_commitment_evidence where workspace_id=$1 and evidence_id=$2", [workspaceId, provider.id])).rowCount, 0);
    assert.equal((await pool.query("select * from recovery_source_health where workspace_id=$1 and source_id=$2", [workspaceId, provider.source_id])).rowCount, 0);
    assert.equal((await pool.query("select * from recovery_commitments where workspace_id=$1 and effective_merchant='Synthetic A2 supplier'", [workspaceId])).rowCount, 0);
    const client = await pool.connect();
    try { assert.equal((await loadRecoveryEvidenceSources(client, workspaceId)).some(source => source.id === provider.source_id), false); }
    finally { client.release(); }
    const commitment = (await pool.query("select id from recovery_commitments where workspace_id=$1 limit 1", [workspaceId])).rows[0];
    assert.ok(commitment, "Ordinary receipt/CSV behavior must still work.");
    await assert.rejects(() => pool.query("insert into recovery_commitment_evidence(workspace_id,commitment_id,evidence_id) values ($1,$2,$3)", [workspaceId, commitment.id, provider.id]), /provider|exposure/i);
    const evaluation = (await pool.query("select id from commitment_control_evaluations where workspace_id=$1 limit 1", [workspaceId])).rows[0];
    await assert.rejects(() => pool.query("insert into commitment_control_evaluation_evidence(workspace_id,evaluation_id,evidence_id) values ($1,$2,$3)", [workspaceId, evaluation.id, provider.id]), /provider|exposure/i);
  });
});

test("provider-only legacy mandates contribute no Autopilot cohort or connected counts before or after source erasure", database, async suite => {
  for (const sourceState of ["CONNECTED", "DISCONNECTED", "ERASED"]) await suite.test(sourceState, async () => {
    await withA2Fixture(async fixture => {
      const { result } = await admitA2(fixture);
      const { pool, workspaceId, ownerId, service } = fixture;
      if (sourceState !== "CONNECTED") {
        const connected = await service.read(workspaceId, ownerId);
        await service.disconnect(workspaceId, ownerId, connected.connection!.revision);
      }
      if (sourceState === "ERASED") {
        const disconnected = await service.read(workspaceId, ownerId);
        await service.erase(workspaceId, ownerId, disconnected.connection!.revision,
          { noticeVersion: "control-provider-bill-retention-v1", retainAdmitted: true, retainedAdmissionCount: 1 });
      }
      const baselineFunnel = await queryAutopilotFunnel(pool);
      const baselineShadow = await measureShadowGate();
      const signed = await signStandingMandate({ workspaceId, actorUserId: ownerId,
        expectedVersion: result.workspaceVersion, idempotencyKey: randomUUID() });
      await runShadowEvaluator(workspaceId);
      const funnel = await queryAutopilotFunnel(pool);
      assert.equal(funnel.connectedActiveMandates, baselineFunnel.connectedActiveMandates);
      assert.equal(funnel.currentlyEligibleAccounts, baselineFunnel.currentlyEligibleAccounts);
      assert.deepEqual(funnel.d30ConnectedRetention, baselineFunnel.d30ConnectedRetention);
      assert.deepEqual(await measureShadowGate(), baselineShadow);
      assert.equal((await pool.query("select * from recovery_connected_mandate_cohort where workspace_id=$1", [workspaceId])).rowCount, 0);
      assert.equal((await pool.query("select * from recovery_action_candidates where workspace_id=$1", [workspaceId])).rowCount, 0);
      const receiptAt = new Date();
      const receipt = await submitRecoveryEvidence({ workspaceId, actorUserId: ownerId, expectedVersion: signed.workspaceVersion,
        idempotencyKey: randomUUID(), now: receiptAt,
        request: { kind: "RECEIPT_PASTE", receipts: [{ clientRef: "synthetic-cohort-receipt",
          text: "Synthetic unrelated software invoice paid INR 100.00 on 3 September 2026. Monthly subscription." }] } });
      await submitRecoveryEvidence({ workspaceId, actorUserId: ownerId, expectedVersion: receipt.workspaceVersion,
        idempotencyKey: randomUUID(), now: receiptAt,
        request: { kind: "CSV_IMPORT", sources: [{ clientRef: "synthetic-cohort-csv", name: "synthetic.csv",
          text: "Date,Description,Amount,Currency\n2026-08-03,Synthetic CSV service,-45.00,INR\n2026-09-03,Synthetic CSV service,-45.00,INR" }] } });
      await runShadowEvaluator(workspaceId);
      assert.equal((await queryAutopilotFunnel(pool)).connectedActiveMandates, baselineFunnel.connectedActiveMandates + 1);
      const cohort = (await pool.query("select started_at from recovery_connected_mandate_cohort where workspace_id=$1", [workspaceId])).rows;
      assert.equal(cohort.length, 1);
      assert.equal(cohort[0].started_at.toISOString(), receiptAt.toISOString());
      const provider = (await pool.query("select id,source_id from recovery_evidence where workspace_id=$1 and evidence_kind='PROVIDER_BILL'", [workspaceId])).rows[0];
      assert.equal((await pool.query("select * from recovery_classification_snapshots where workspace_id=$1 and $2::uuid=any(evidence_ids)", [workspaceId, provider.id])).rowCount, 0);
      await pool.query(`insert into recovery_source_disconnections(workspace_id,source_id)
        select workspace_id,id from recovery_sources where workspace_id=$1 and source_type in ('RECEIPT_PASTE','CSV_IMPORT')`, [workspaceId]);
      await runShadowEvaluator(workspaceId);
      assert.equal((await queryAutopilotFunnel(pool)).connectedActiveMandates, baselineFunnel.connectedActiveMandates);
      assert.equal((await pool.query("select * from recovery_connected_mandate_cohort where workspace_id=$1", [workspaceId])).rowCount, 1);
      assert.equal((await pool.query("select observed_at from recovery_evidence where id=$1", [provider.id])).rows[0].observed_at, null);
    });
  });
});

test("provider candidate pages bind the source snapshot, literal query, currency and proposal without admitting evidence", database, async () => {
  await withA2Fixture(async fixture => {
    const { workspaceId, ownerId, pool, service, setBills, connect, authorize } = fixture;
    const { proposal } = await authorize();
    const bills = Array.from({ length: 121 }, (_, index) => ({ ...initialBill, bill_id: String(400000 + index),
      bill_number: `SYNTHETIC-PAGE-${index}`, vendor_name: `Synthetic supplier ${String(index).padStart(3, "0")}`,
      currency_code: index < 110 ? "INR" : "USD" }));
    bills[0].vendor_name = "Synthetic 100%_literal supplier";
    setBills(bills);
    await connect();
    const input = { workspaceId, actorUserId: ownerId, proposalId: proposal.data.proposal.id, source: "ZOHO_BOOKS" as const,
      sort: "SUPPLIER" as const, search: "Synthetic", currency: "INR", now: capturedAt };
    const first = await getControlReconciliationCandidates(input);
    assert.equal((first.data as unknown as Record<string, unknown>).source, "ZOHO_BOOKS");
    const page = first.data as unknown as { candidates: Array<{ billId: string; canSelect: boolean; sourceSequence: string; consentReference: string | null }>; total: number; nextCursor: string; throughSequence: string };
    assert.equal(page.candidates.length, 50);
    assert.equal(page.total, 110);
    assert.ok(page.candidates[0].consentReference);
    assert.equal(page.candidates[0].canSelect, true);
    assert.ok(page.nextCursor);
    assert.equal((await pool.query("select id from recovery_evidence where workspace_id=$1", [workspaceId])).rowCount, 0);
    bills[0] = { ...bills[0], total: 130, balance: 130, last_modified_time: "2026-09-08T00:00:00+0530" };
    setBills(bills);
    await service.runDue(new Date("2026-09-08T00:00:00.000Z"));
    const second = (await getControlReconciliationCandidates({ ...input, cursor: page.nextCursor, now: new Date("2026-09-08T00:00:00.000Z") })).data as unknown as typeof page;
    assert.equal(second.throughSequence, page.throughSequence);
    assert.equal(second.candidates.length, 50);
    const third = (await getControlReconciliationCandidates({ ...input, cursor: second.nextCursor })).data as unknown as typeof page;
    assert.equal(third.candidates.length, 10);
    assert.equal(new Set([...page.candidates, ...second.candidates, ...third.candidates].map(item => item.billId)).size, 110);
    await assert.rejects(() => getControlReconciliationCandidates({ ...input, cursor: page.nextCursor, currency: "USD" }), /cursor|page|query/i);
    const literal = (await getControlReconciliationCandidates({ ...input, search: "100%_literal" })).data as unknown as typeof page;
    assert.equal(literal.total, 1);
  });
});

test("Control preserves the original comparison and exposes later material responsibility independently of informational updates", database, async () => {
  await withA2Fixture(async fixture => {
    const { input, result } = await admitA2(fixture);
    const { workspaceId, ownerId, setBill, service } = fixture;
    setBill({ ...initialBill, total: 130, balance: 130, last_modified_time: "2026-09-08T00:00:00+0530" });
    await service.runDue(new Date("2026-09-08T00:00:00.000Z"));
    const material = (await service.read(workspaceId, ownerId, { view: "ALL" })).items[0];
    setBill({ ...initialBill, total: 130, status: "paid", balance: 0, last_modified_time: "2026-09-09T00:00:00+0530" });
    await service.runDue(new Date("2026-09-09T00:00:00.000Z"));
    const brief = await getCommitmentControlBrief({ workspaceId, actorUserId: ownerId });
    const record = brief.data.proposals[0].reconciliations[0];
    assert.equal(record.observedAmountMinor, "12345");
    assert.equal(record.verdict, "MATCHED");
    const source = (record as unknown as { providerBillSource: { condition: string; pendingMaterialNewerCount: number; pendingMaterialNewerSequences: string[]; billReviewPath: string | null; currentReviewRelevance: string } }).providerBillSource;
    assert.ok(source, "Control must expose the live linked-source responsibility separately from the frozen comparison.");
    assert.equal(source.pendingMaterialNewerCount, 1);
    assert.deepEqual(source.pendingMaterialNewerSequences, [material.sequence]);
    assert.equal(source.currentReviewRelevance, "INFORMATIONAL");
    assert.match(source.billReviewPath!, /view=BILL_REVIEW.*bill=200001/);
    assert.deepEqual((await reconcileCommitmentControlProposal(input)).data, result.data);
    assert.equal((await service.detail(workspaceId, ownerId, "200001")).events.length, 0);
  });
});

test("source erasure requires retained-admission acknowledgement and leaves exact detached result and replay", database, async () => {
  await withA2Fixture(async fixture => {
    const { input, result } = await admitA2(fixture);
    const { pool, workspaceId, ownerId, service } = fixture;
    let state = await service.read(workspaceId, ownerId);
    assert.equal((state as unknown as { retainedAdmissionCount: number }).retainedAdmissionCount, 1);
    await service.disconnect(workspaceId, ownerId, state.connection!.revision);
    assert.deepEqual((await reconcileCommitmentControlProposal(input)).data, result.data);
    state = await service.read(workspaceId, ownerId);
    await assert.rejects(() => service.erase(workspaceId, ownerId, state.connection!.revision), /acknowledge|retained|retention/i);
    await assert.rejects(() => service.erase(workspaceId, ownerId, state.connection!.revision,
      { noticeVersion: "old", retainAdmitted: true, retainedAdmissionCount: 1 }), /acknowledge|retention/i);
    await service.erase(workspaceId, ownerId, state.connection!.revision,
      { noticeVersion: "control-provider-bill-retention-v1", retainAdmitted: true, retainedAdmissionCount: 1 });
    for (const table of ["zoho_books_connections", "zoho_books_grants", "zoho_books_snapshots", "zoho_books_records", "zoho_books_reviews", "zoho_books_dispositions"]) {
      assert.equal((await pool.query(`select count(*)::text as count from ${table} where workspace_id=$1`, [workspaceId])).rows[0].count, "0", table);
    }
    assert.equal((await pool.query("select * from recovery_provider_bill_links where workspace_id=$1", [workspaceId])).rowCount, 1);
    assert.equal((await pool.query("select * from commitment_control_reconciliations where workspace_id=$1", [workspaceId])).rowCount, 1);
    assert.deepEqual((await reconcileCommitmentControlProposal(input)).data, result.data);
    const brief = await getCommitmentControlBrief({ workspaceId, actorUserId: ownerId, now: capturedAt });
    assert.equal(brief.data.proposals[0].reconciliations[0].providerBillSource?.condition, "ERASED");
    assert.equal(brief.data.proposals[0].reconciliations[0].providerBill?.totalMinor, "12345");
    const request = await createAccessExportRequest({ workspaceId, actorUserId: ownerId });
    const exported = await downloadAccessExport({ workspaceId, actorUserId: ownerId, requestId: request.id });
    assert.ok(exported.status === "ok");
    const document = JSON.parse(exported.serialized);
    assert.equal(document.recovery.providerBillLinks[0].source_sequence, input.request.sourceSequence);
    assert.equal(document.recovery.providerBillLinks[0].sourceContentDigest, result.data.reconciliation.providerBill?.sourceFingerprint);
    assert.equal(document.zohoBooks.snapshots.length, 0);
    assert.equal(document.commitmentControl.reconciliations[0].comparisonKind, "BILLED_AMOUNT_COMPARISON");
  });
});

test("workspace export includes immutable original grant, capture binding, admitted lineage and both frozen bases", database, async () => {
  await withA2Fixture(async fixture => {
    const { input, result } = await admitA2(fixture);
    const { workspaceId, ownerId } = fixture;
    const request = await createAccessExportRequest({ workspaceId, actorUserId: ownerId });
    const exported = await downloadAccessExport({ workspaceId, actorUserId: ownerId, requestId: request.id });
    assert.ok(exported.status === "ok");
    const document = JSON.parse(exported.serialized);
    assert.equal(document.commitmentControl.proposals[0].amountBasis, "GROSS_BILLED_TOTAL_PER_CHARGE");
    assert.equal(document.commitmentControl.evaluations[0].amountBasis, "GROSS_BILLED_TOTAL_PER_CHARGE");
    assert.equal(document.commitmentControl.decisions[0].amountBasis, "GROSS_BILLED_TOTAL_PER_CHARGE");
    assert.equal(document.commitmentControl.reconciliations[0].observedEvidenceBasis, "PROVIDER_BILL_TOTAL");
    assert.equal(document.recovery.evidence[0].evidenceBasis, "PROVIDER_BILL_TOTAL");
    assert.equal(document.recovery.evidence[0].observedAt, null);
    assert.equal(document.recovery.providerBillLinks[0].source_sequence, input.request.sourceSequence);
    assert.equal(document.zohoBooks.grants.length, 1);
    assert.equal(document.zohoBooks.snapshots[0].grantId, document.zohoBooks.grants[0].id);
    assert.equal(document.zohoBooks.snapshots[0].organizationId, "100001");
    assert.equal(document.zohoBooks.snapshots[0].sourceContentDigest, result.data.reconciliation.providerBill?.sourceFingerprint);
    assert.equal(exported.serialized.includes("synthetic-refresh"), false);
    assert.equal(exported.serialized.includes("access_secret"), false);
  });
});

test("original provider write replay requires current read access, not a new financial authorization", database, async () => {
  await withA2Fixture(async fixture => {
    const { input, result } = await admitA2(fixture);
    await fixture.pool.query("update workspace_members set role='viewer' where workspace_id=$1 and user_id=$2", [fixture.workspaceId, fixture.ownerId]);
    const replay = await reconcileCommitmentControlProposal(input);
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.data, result.data);
    await assert.rejects(() => reconcileCommitmentControlProposal({ ...input, expectedVersion: result.workspaceVersion, idempotencyKey: randomUUID() }), (error: unknown) => error instanceof RecoveryServiceError && error.code === "FORBIDDEN");
    await fixture.pool.query("delete from workspace_members where workspace_id=$1 and user_id=$2", [fixture.workspaceId, fixture.ownerId]);
    await assert.rejects(() => reconcileCommitmentControlProposal(input), (error: unknown) => error instanceof RecoveryServiceError && error.code === "FORBIDDEN");
  });
});

test("A2 real HTTP handlers create, authorize, page, confirm, reload and erase source with retained-result acknowledgement", database, async () => {
  await withA2Fixture(async fixture => {
    const { workspaceId, ownerId, service, setBill, connect } = fixture;
    const origin = "http://127.0.0.1:57610";
    const cookie = await createSessionCookie({ workspaceId, userId: ownerId });
    const cookieHeader = `${cookie.name}=${encodeURIComponent(cookie.value)}`;
    const read = (path: string) => new Request(`${origin}${path}`, { headers: { cookie: cookieHeader, "x-vognary-workspace": workspaceId } });
    const write = (path: string, body: unknown, version: number, key = randomUUID(), method = "POST") => new Request(`${origin}${path}`, {
      method, headers: { cookie: cookieHeader, origin, "content-type": "application/json", "idempotency-key": key, "if-match": `"workspace:${version}"`, "x-vognary-workspace": workspaceId }, body: JSON.stringify(body),
    });
    const policy = await policyHandler(write("/api/workspaces/current/control/policy", completeControlPolicyRequest(), 0, randomUUID(), "PUT"));
    assert.equal(policy.status, 201, await policy.clone().text());
    const today = futureControlTestDate(0);
    const reviewOn = futureControlTestDate(10);
    const proposalBody = { ...proposalRequest, firstChargeDate: today, intendedOutcome: { ...proposalRequest.intendedOutcome, reviewOn } };
    const proposed = await proposalHandler(write("/api/workspaces/current/control/proposals", proposalBody, 1));
    assert.equal(proposed.status, 201, await proposed.clone().text());
    const proposalId = (await proposed.json()).data.proposal.id as string;
    const context = { params: Promise.resolve({ proposalId }) };
    const path = `/api/workspaces/current/control/proposals/${proposalId}`;
    const decision = await decisionHandler(write(`${path}/decision`, { action: "APPROVE", authorizationExpiresOn: reviewOn }, 2), context);
    assert.equal(decision.status, 201, await decision.clone().text());
    setBill({ ...initialBill, date: today, last_modified_time: new Date().toISOString() });
    await connect(new Date());
    const listing = await candidateHandler(read(`${path}/reconciliation-candidates?source=ZOHO_BOOKS&sort=AMOUNT_DESC&currency=INR`), context);
    assert.equal(listing.status, 200, await listing.clone().text());
    assert.match(listing.headers.get("cache-control") ?? "", /no-store/);
    const page = (await listing.json()).data;
    assert.equal(page.source, "ZOHO_BOOKS");
    assert.equal(page.candidates[0].canSelect, true);
    assert.equal(page.matchingPerformed, false);
    const selected = page.candidates[0];
    const body = { source: "ZOHO_BOOKS", connectionId: selected.connectionId, organizationId: selected.organizationId,
      billId: selected.billId, sourceSequence: selected.sourceSequence, expectedSourceVersion: selected.expectedSourceVersion,
      expectedLatestSequence: selected.expectedLatestSequence, wholeCharge: "USER_CONFIRMED_SAME_CHARGE", retentionNotice: page.retentionNotice };
    const badMoney = await reconciliationHandler(write(`${path}/reconciliations`, { ...body, totalMinor: "1" }, 3), context);
    assert.equal(badMoney.status, 400);
    const badQuery = await candidateHandler(read(`${path}/reconciliation-candidates?source=ZOHO_BOOKS&totalMinor=1`), context);
    assert.equal(badQuery.status, 400);
    const key = randomUUID();
    const comparison = await reconciliationHandler(write(`${path}/reconciliations`, body, 3, key), context);
    assert.equal(comparison.status, 201, await comparison.clone().text());
    assert.equal(comparison.headers.get("etag"), '"workspace:4"');
    const saved = (await comparison.json()).data;
    assert.equal(isControlReconciliationWriteDto(saved), true);
    assert.equal(saved.reconciliation.comparisonKind, "BILLED_AMOUNT_COMPARISON");
    const reloaded = await briefHandler(read("/api/workspaces/current/control/brief"));
    assert.equal(reloaded.status, 200);
    const briefResponse = await reloaded.json();
    assert.equal(briefResponse.data.proposals[0].reconciliations[0].providerBill.totalMinor, "12345");
    const state = await service.read(workspaceId, ownerId);
    await service.disconnect(workspaceId, ownerId, state.connection!.revision);
    const revoked = await sourceHandler(read("/api/workspaces/current/sources/zoho-books"));
    const source = (await revoked.json()).data;
    const erase = { action: "ERASE", confirmation: "DELETE_OBSERVATIONS", revision: source.connection.revision };
    assert.equal((await sourceActionHandler(write("/api/workspaces/current/sources/zoho-books", erase, 4))).status, 400);
    const erased = await sourceActionHandler(write("/api/workspaces/current/sources/zoho-books", { ...erase,
      retentionAcknowledgement: { noticeVersion: source.retentionNotice, retainAdmitted: true, retainedAdmissionCount: source.retainedAdmissionCount } }, 4));
    assert.equal(erased.status, 200, await erased.clone().text());
    const replay = await reconciliationHandler(write(`${path}/reconciliations`, body, 3, key), context);
    assert.equal(replay.status, 200, await replay.clone().text());
    assert.deepEqual((await replay.json()).data, saved);
    const artifactDirectory = mkdtempSync(join(fixtureArtifactDirectory, "http-contract-"));
    writeFileSync(join(artifactDirectory, "synthetic-http-contract.json"), JSON.stringify({
      source: "SYNTHETIC_LOOPBACK_HANDLER_TEST", endpoints: { candidates: `${path}/reconciliation-candidates?source=ZOHO_BOOKS`, reconciliations: `${path}/reconciliations`, source: "/api/workspaces/current/sources/zoho-books" },
      requestHeaders: { "If-Match": '"workspace:3"', "Idempotency-Key": key, "X-Vognary-Workspace": workspaceId },
      proposalRequest: proposalBody, decisionRequest: { action: "APPROVE", authorizationExpiresOn: reviewOn },
      candidatesResponse: page, comparisonRequest: body, comparisonResponse: saved,
      briefResponse, revokedSourceResponse: source,
      requiredFlags: ["CONTROL_PROVIDER_BILL_WORKSPACE_IDS", "COMMITMENT_CONTROL_PILOT_WORKSPACE_IDS", "ZOHO_BOOKS_PILOT_WORKSPACE_IDS"],
      sourceFreshness: { maximumAgeSeconds: 86400, requiresCompletedSync: true, requiresReadyState: true, requiresValidNextSchedule: true, requiresExactLatestSnapshot: true },
      erasureRequest: { ...erase, retentionAcknowledgement: { noticeVersion: source.retentionNotice, retainAdmitted: true, retainedAdmissionCount: source.retainedAdmissionCount } },
    }, null, 2));
    console.log(`Synthetic A2 HTTP payload artifact: ${artifactDirectory}/synthetic-http-contract.json`);
  });
});

test("A2 admission fails closed on incompatible financial facts, stale source, missing consent and identity substitution", database, async suite => {
  const scenarios = ["draft", "pending_approval", "void", "zero", "pre-authorization", "future", "legacy-basis",
    "stale-sync", "incomplete-sync", "missing-schedule", "ambiguous-absence", "missing-consent", "legacy-capture",
    "wrong-connection", "wrong-organization", "wrong-bill", "wrong-sequence", "stale-source-version", "stale-latest", "stale-control", "deleted-actor"];
  for (const scenario of scenarios) await suite.test(scenario, async () => {
    await withA2Fixture(async fixture => {
      const { pool, workspaceId, ownerId, service, connect, setBill, authorize } = fixture;
      const requestForProposal = { ...proposalRequest };
      if (scenario === "legacy-basis") delete requestForProposal.amountBasis;
      const { proposal, decision } = await authorize(requestForProposal);
      if (["draft", "pending_approval", "void"].includes(scenario)) setBill({ ...initialBill, status: scenario });
      if (scenario === "zero") setBill({ ...initialBill, total: 0, balance: 0 });
      if (scenario === "pre-authorization") setBill({ ...initialBill, date: "2026-08-31" });
      if (scenario === "future") setBill({ ...initialBill, date: "2026-09-08" });
      await connect();
      if (scenario === "stale-sync") await pool.query("update zoho_books_connections set last_success_at=$2 where workspace_id=$1", [workspaceId, new Date("2026-09-05T00:00:00.000Z")]);
      if (scenario === "incomplete-sync") await pool.query("update zoho_books_connections set status='SYNCING' where workspace_id=$1", [workspaceId]);
      if (scenario === "missing-schedule") await pool.query("update zoho_books_connections set next_run_at=null where workspace_id=$1", [workspaceId]);
      if (scenario === "ambiguous-absence") await pool.query("update zoho_books_connections set status='FAILED',last_error_code='ABSENCE_UNCONFIRMED',next_run_at=null where workspace_id=$1", [workspaceId]);
      if (scenario === "missing-consent") await pool.query("update zoho_books_connections set active_grant_id=null where workspace_id=$1", [workspaceId]);
      if (scenario === "deleted-actor") await pool.query("update users set deleted_at=$2 where id=$1", [ownerId, capturedAt]);
      if (scenario === "legacy-capture") {
        const unbound = (await pool.query("insert into zoho_books_snapshots(connection_id,workspace_id,bill_id,fingerprint,bill,change_kind,observed_at) select connection_id,workspace_id,bill_id,$2,bill,change_kind,observed_at from zoho_books_snapshots where workspace_id=$1 returning sequence", [workspaceId, randomUUID().replaceAll("-", "").repeat(2)])).rows[0];
        await pool.query("update zoho_books_records set latest_sequence=$2 where workspace_id=$1", [workspaceId, unbound.sequence]);
      }
      const source = await service.read(workspaceId, ownerId, { view: "ALL" });
      const request = normalizeControlProviderBillRequest({ source: "ZOHO_BOOKS", connectionId: source.connection!.id,
        organizationId: "100001", billId: "200001", sourceSequence: source.items[0].sequence,
        expectedLatestSequence: source.items[0].sequence, expectedSourceVersion: source.connection!.revision,
        wholeCharge: "USER_CONFIRMED_SAME_CHARGE", retentionNotice: "control-provider-bill-retention-v1" });
      if (scenario === "wrong-connection") request.connectionId = randomUUID();
      if (scenario === "wrong-organization") request.organizationId = "999999";
      if (scenario === "wrong-bill") request.billId = "999999";
      if (scenario === "wrong-sequence") request.sourceSequence = "9223372036854775807";
      if (scenario === "stale-source-version") request.expectedSourceVersion = "1";
      if (scenario === "stale-latest") request.expectedLatestSequence = "9223372036854775807";
      const expected = scenario.startsWith("wrong-") ? "NOT_FOUND" : ["stale-source-version", "stale-latest", "stale-control"].includes(scenario) ? "STALE_STATE" : scenario === "deleted-actor" ? "FORBIDDEN" : "INVALID_EVIDENCE";
      await assert.rejects(() => reconcileCommitmentControlProposal({ workspaceId, actorUserId: ownerId, proposalId: proposal.data.proposal.id,
        expectedVersion: scenario === "stale-control" ? 0 : decision.workspaceVersion, idempotencyKey: randomUUID(), request, now: capturedAt }),
        (error: unknown) => error instanceof RecoveryServiceError && error.code === expected);
      for (const table of ["recovery_sources", "recovery_evidence", "recovery_provider_bill_links", "commitment_control_reconciliations"]) {
        assert.equal((await pool.query(`select count(*)::text as count from ${table} where workspace_id=$1`, [workspaceId])).rows[0].count, "0", table);
      }
      assert.equal((await pool.query("select version::text from recovery_workspace_states where workspace_id=$1", [workspaceId])).rows[0].version, String(decision.workspaceVersion));
    });
  });
});

test("direct SQL cannot omit provider comparison bases or the whole-charge retention decision", database, async () => {
  await withA2Fixture(async fixture => {
    const { result } = await admitA2(fixture);
    const next = await fixture.authorize();
    for (const column of ["decision_amount_basis", "observed_evidence_basis", "relation_basis", "retention_notice"]) {
      const values = { decision_amount_basis: "'GROSS_BILLED_TOTAL_PER_CHARGE'", observed_evidence_basis: "'PROVIDER_BILL_TOTAL'", relation_basis: "'USER_CONFIRMED_SAME_CHARGE'", retention_notice: "'control-provider-bill-retention-v1'", [column]: "null" };
      await assert.rejects(() => fixture.pool.query(`insert into commitment_control_reconciliations(id,workspace_id,proposal_id,decision_id,evidence_id,verdict,
        expected_amount_minor,approved_cap_minor,authorization_currency,observed_amount_minor,observed_currency,observed_evidence_date,
        reconciled_by_user_id,reconciled_at,comparison_kind,decision_amount_basis,observed_evidence_basis,relation_basis,retention_notice)
        select $2,workspace_id,$3,$4,evidence_id,verdict,expected_amount_minor,approved_cap_minor,authorization_currency,observed_amount_minor,
          observed_currency,observed_evidence_date,reconciled_by_user_id,reconciled_at,comparison_kind,
          ${values.decision_amount_basis},${values.observed_evidence_basis},${values.relation_basis},${values.retention_notice}
        from commitment_control_reconciliations where id=$1`,
        [result.data.reconciliation.id, randomUUID(), next.proposal.data.proposal.id, next.decision.data.decision.id]),
        (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "23514"));
    }
  });
});

test("direct SQL cannot select an organization outside the original authorized account", database, async () => {
  await withA2Fixture(async ({ pool, workspaceId, ownerId, service }) => {
    const authorization = await service.begin(workspaceId, ownerId, capturedAt);
    await service.complete(workspaceId, ownerId, new URL(authorization.authorizationUrl).searchParams.get("state")!, "synthetic-code", capturedAt);
    await assert.rejects(() => pool.query("update zoho_books_connections set organization_id='999999',status='QUEUED' where workspace_id=$1", [workspaceId]), /organization|authorized/i);
  });
});

test("mutable connection choices cannot substitute an organization outside the immutable original grant", database, async () => {
  await withA2Fixture(async ({ pool, workspaceId, ownerId, service }) => {
    const authorization = await service.begin(workspaceId, ownerId, capturedAt);
    await service.complete(workspaceId, ownerId, new URL(authorization.authorizationUrl).searchParams.get("state")!, "synthetic-code", capturedAt);
    await pool.query("update zoho_books_connections set organizations=$2 where workspace_id=$1", [workspaceId, JSON.stringify([{ id: "999999", name: "Synthetic substituted organization", currency: "INR", active: true }])]);
    const state = await service.read(workspaceId, ownerId);
    await assert.rejects(() => service.select(workspaceId, ownerId, "999999", state.connection!.revision, capturedAt), /organization|grant|authorized/i);
  });
});

test("a new direct-SQL billed comparison cannot reuse retained evidence after source consent withdrawal", database, async () => {
  await withA2Fixture(async fixture => {
    const { result } = await admitA2(fixture);
    const next = await fixture.authorize();
    const state = await fixture.service.read(fixture.workspaceId, fixture.ownerId);
    await fixture.service.disconnect(fixture.workspaceId, fixture.ownerId, state.connection!.revision);
    await assert.rejects(() => fixture.pool.query(`insert into commitment_control_reconciliations
      select (jsonb_populate_record(null::commitment_control_reconciliations,to_jsonb(comparison) || jsonb_build_object('id',$2::text,'proposal_id',$3::text,'decision_id',$4::text))).*
      from commitment_control_reconciliations comparison where id=$1`, [result.data.reconciliation.id, randomUUID(), next.proposal.data.proposal.id, next.decision.data.decision.id]),
      (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "23514"));
  });
});

test("billed DTO guards reject tampered or missing immutable source provenance", database, async () => {
  await withA2Fixture(async fixture => {
    const { result } = await admitA2(fixture);
    assert.equal(isControlReconciliationWriteDto(result.data), true);
    for (const replacement of [
      { workspaceId: "foreign" }, { connectionId: "foreign" }, { organizationId: "foreign" }, { billId: "foreign" },
      { sourceSequence: "0" }, { sourceSequence: "9223372036854775808" }, { sourceVersion: 2 },
      { sourceFingerprint: "missing" }, { consentReference: "foreign" }, { consentScopes: [] },
      { consentAuthorizedAt: "2026-09-08T00:00:00.000Z" }, { sourceObservedAt: "2026-09-09T00:00:00.000Z" },
      { selectedAt: "invalid" }, { region: "US" }, { totalMinor: "0" }, { billStatus: "draft" },
    ]) {
      assert.equal(isControlReconciliationWriteDto({ ...result.data, reconciliation: { ...result.data.reconciliation,
        providerBill: { ...result.data.reconciliation.providerBill, ...replacement } } }), false, JSON.stringify(replacement));
    }
  });
});


test("failed comparison or audit writes roll back admission, source, version and idempotency atomically", database, async suite => {
  for (const target of ["commitment_control_reconciliations", "audit_log"]) await suite.test(target, async () => {
    await withA2Fixture(async fixture => {
      const input = await prepareA2(fixture);
      const { pool, workspaceId } = fixture;
      await pool.query(`create function a2_injected_failure() returns trigger language plpgsql as $$ begin
        if new.workspace_id='${workspaceId}'::uuid then raise exception 'Synthetic A2 injected write failure.'; end if; return new; end; $$`);
      await pool.query(`create trigger a2_injected_failure before insert on ${target} for each row execute function a2_injected_failure()`);
      try {
        await assert.rejects(() => reconcileCommitmentControlProposal(input), /Synthetic A2 injected/);
        for (const table of ["recovery_submissions", "recovery_sources", "recovery_evidence", "recovery_provider_bill_links", "commitment_control_reconciliations"]) {
          assert.equal((await pool.query(`select count(*)::text as count from ${table} where workspace_id=$1`, [workspaceId])).rows[0].count, "0", table);
        }
        assert.equal((await pool.query("select * from recovery_idempotency_keys where workspace_id=$1 and idempotency_key=$2", [workspaceId, input.idempotencyKey])).rowCount, 0);
        assert.equal((await pool.query("select version::text from recovery_workspace_states where workspace_id=$1", [workspaceId])).rows[0].version, String(input.expectedVersion));
      } finally {
        await pool.query(`drop trigger a2_injected_failure on ${target}`);
        await pool.query("drop function a2_injected_failure()");
      }
      assert.equal((await reconcileCommitmentControlProposal(input)).replayed, false);
    });
  });
});

test("concurrent confirmation retries commit once, cross-actor keys conflict, and separate decisions reuse canonical evidence", database, async () => {
  await withA2Fixture(async fixture => {
    const input = await prepareA2(fixture);
    const { pool, workspaceId, ownerId } = fixture;
    const results = await Promise.all([reconcileCommitmentControlProposal(input), reconcileCommitmentControlProposal(input)]);
    assert.deepEqual(results.map(result => result.replayed).sort(), [false, true]);
    assert.deepEqual(results[0].data, results[1].data);
    const otherActor = randomUUID();
    await pool.query("insert into users(id,email) values($1,$2)", [otherActor, `synthetic-a2-second-${otherActor}@example.test`]);
    await pool.query("insert into workspace_members(workspace_id,user_id,role) values($1,$2,'admin')", [workspaceId, otherActor]);
    try {
      await assert.rejects(() => reconcileCommitmentControlProposal({ ...input, actorUserId: otherActor }),
        (error: unknown) => error instanceof RecoveryServiceError && error.code === "CONFLICT");
      await pool.query("delete from workspace_members where workspace_id=$1 and user_id=$2", [workspaceId, otherActor]);
    } finally { await pool.query("delete from users where id=$1", [otherActor]); }
    const second = await fixture.authorize();
    const reusing = await reconcileCommitmentControlProposal({ ...input, proposalId: second.proposal.data.proposal.id,
      expectedVersion: second.decision.workspaceVersion, idempotencyKey: randomUUID() });
    assert.equal(reusing.data.reconciliation.evidenceId, results[0].data.reconciliation.evidenceId);
    assert.equal((await pool.query("select * from recovery_provider_bill_links where workspace_id=$1", [workspaceId])).rowCount, 1);
    assert.equal((await getCommitmentControlBrief({ workspaceId, actorUserId: ownerId })).data.proposals.length, 2);
  });
});

test("simultaneous different request keys cannot duplicate one decision and snapshot", database, async () => {
  await withA2Fixture(async fixture => {
    const input = await prepareA2(fixture);
    const results = await Promise.allSettled([reconcileCommitmentControlProposal(input), reconcileCommitmentControlProposal({ ...input, idempotencyKey: randomUUID() })]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    const rejected = results.find(result => result.status === "rejected");
    assert.ok(rejected?.status === "rejected" && rejected.reason instanceof RecoveryServiceError && ["STALE_STATE", "CONFLICT"].includes(rejected.reason.code));
    assert.equal((await fixture.pool.query("select * from recovery_evidence where workspace_id=$1", [fixture.workspaceId])).rowCount, 1);
    assert.equal((await fixture.pool.query("select * from commitment_control_reconciliations where workspace_id=$1", [fixture.workspaceId])).rowCount, 1);
  });
});

test("a source amendment ahead of a waiting confirmation cannot produce partial or substituted admission", database, async () => {
  await withA2Fixture(async fixture => {
    const input = await prepareA2(fixture);
    const lock = await fixture.pool.connect();
    let attempt: ReturnType<typeof reconcileCommitmentControlProposal> | undefined;
    try {
      await lock.query("begin");
      await lock.query("select id from zoho_books_connections where workspace_id=$1 for update", [fixture.workspaceId]);
      attempt = reconcileCommitmentControlProposal(input);
      const rejection = assert.rejects(attempt, (error: unknown) => error instanceof RecoveryServiceError && error.code === "STALE_STATE");
      const amended = (await lock.query(`insert into zoho_books_snapshots(connection_id,workspace_id,bill_id,fingerprint,bill,change_kind,observed_at,grant_id,organization_id)
        select connection_id,workspace_id,bill_id,$2,jsonb_set(jsonb_set(jsonb_set(bill,'{totalMinor}','"13000"'),'{sourceTotal}','"130.00"'),'{balanceMinor}','"13000"'),'AMENDED',observed_at,grant_id,organization_id
        from zoho_books_snapshots where workspace_id=$1 order by sequence desc limit 1 returning sequence`, [fixture.workspaceId, "b".repeat(64)])).rows[0];
      await lock.query("update zoho_books_records set latest_sequence=$2 where workspace_id=$1", [fixture.workspaceId, amended.sequence]);
      await lock.query("commit");
      await rejection;
      assert.equal((await fixture.pool.query("select * from recovery_provider_bill_links where workspace_id=$1", [fixture.workspaceId])).rowCount, 0);
    } finally {
      await lock.query("rollback");
      lock.release();
      if (attempt) await attempt.catch(() => undefined);
    }
  });
});

test("concurrent disconnect and confirmation serialize; source erasure never destroys a committed comparison", database, async () => {
  await withA2Fixture(async fixture => {
    const input = await prepareA2(fixture);
    const { service, workspaceId, ownerId, pool } = fixture;
    const state = await service.read(workspaceId, ownerId);
    const results = await Promise.allSettled([reconcileCommitmentControlProposal(input), service.disconnect(workspaceId, ownerId, state.connection!.revision)]);
    assert.equal(results[1].status, "fulfilled");
    const confirmation = results[0];
    const revoked = await service.read(workspaceId, ownerId);
    const retained = revoked.retainedAdmissionCount;
    assert.equal(retained, confirmation.status === "fulfilled" ? 1 : 0);
    if (confirmation.status === "rejected") assert.ok(confirmation.reason instanceof RecoveryServiceError && ["STALE_STATE", "INVALID_EVIDENCE"].includes(confirmation.reason.code));
    const erasure = service.erase(workspaceId, ownerId, revoked.connection!.revision,
      retained ? { noticeVersion: "control-provider-bill-retention-v1", retainAdmitted: true, retainedAdmissionCount: retained } : undefined);
    const retry = reconcileCommitmentControlProposal(input);
    const [erased, replayed] = await Promise.allSettled([erasure, retry]);
    assert.equal(erased.status, "fulfilled");
    if (confirmation.status === "fulfilled") {
      assert.equal(replayed.status, "fulfilled");
      if (replayed.status === "fulfilled") assert.deepEqual(replayed.value.data, confirmation.value.data);
    } else assert.equal(replayed.status, "rejected");
    assert.equal((await pool.query("select count(*)::integer as count from recovery_provider_bill_links where workspace_id=$1", [workspaceId])).rows[0].count, retained);
  });
});

test("whole-workspace erasure removes the complete admitted chain while direct history edits and foreign workspace substitutions fail", database, async () => {
  await withA2Fixture(async fixture => {
    const { input, result } = await admitA2(fixture);
    const { pool, workspaceId, ownerId } = fixture;
    for (const query of [
      "update recovery_provider_bill_links set total_minor=1 where workspace_id=$1",
      "update recovery_provider_bill_links set connection_id=gen_random_uuid() where workspace_id=$1",
      "update recovery_provider_bill_links set consent_authorized_by_user_id=null where workspace_id=$1",
      "delete from recovery_provider_bill_links where workspace_id=$1",
      "update recovery_evidence set observed_at=now() where workspace_id=$1",
      "update commitment_control_reconciliations set observed_amount_minor=1 where workspace_id=$1",
    ]) await assert.rejects(() => pool.query(query, [workspaceId]), /immutable|cannot be updated/i);
    const otherWorkspace = randomUUID();
    await pool.query("insert into workspaces(id,owner_user_id,name) values($1,$2,'Synthetic other A2 workspace')", [otherWorkspace, ownerId]);
    await pool.query("insert into workspace_members(workspace_id,user_id,role) values($1,$2,'owner')", [otherWorkspace, ownerId]);
    try {
      await assert.rejects(() => reconcileCommitmentControlProposal({ ...input, workspaceId: otherWorkspace, expectedVersion: 0 }),
        (error: unknown) => error instanceof RecoveryServiceError && error.code === "NOT_FOUND");
      await assert.rejects(() => pool.query("update zoho_books_snapshots set workspace_id=$2 where workspace_id=$1", [workspaceId, otherWorkspace]), /immutable/i);
    } finally { await pool.query("delete from workspaces where id=$1", [otherWorkspace]); }
    await pool.query("delete from workspaces where id=$1", [workspaceId]);
    for (const table of ["zoho_books_connections", "zoho_books_grants", "zoho_books_snapshots", "recovery_sources", "recovery_submissions", "recovery_evidence", "recovery_provider_bill_links", "commitment_control_proposals", "commitment_control_decisions", "commitment_control_reconciliations", "recovery_idempotency_keys"]) {
      assert.equal((await pool.query(`select count(*)::text as count from ${table} where workspace_id=$1`, [workspaceId])).rows[0].count, "0", table);
    }
    assert.ok(result.data.reconciliation.evidenceId);
  });
});

test("unchanged old captured bills remain selectable only after a fresh completed source sync", database, async () => {
  await withA2Fixture(async fixture => {
    const input = await prepareA2(fixture);
    const later = new Date("2026-09-09T00:00:00.000Z");
    await assert.rejects(() => reconcileCommitmentControlProposal({ ...input, now: later }), /SOURCE_STALE/);
    await fixture.service.runDue(later);
    const state = await fixture.service.read(fixture.workspaceId, fixture.ownerId, { view: "ALL" });
    assert.equal(state.items[0].sequence, input.request.sourceSequence);
    assert.equal(state.items[0].observedAt, capturedAt.toISOString());
    const result = await reconcileCommitmentControlProposal({ ...input, now: later });
    assert.equal(result.data.reconciliation.providerBill?.sourceObservedAt, capturedAt.toISOString());
    assert.equal(result.data.reconciliation.providerBill?.lastSuccessfulSyncAt, later.toISOString());
    assert.equal(result.data.reconciliation.verdict, "MATCHED");
  });
});

test("admitted provider bills never increase Recovery home source coverage, including after source erasure", database, async () => {
  await withA2Fixture(async fixture => {
    const { workspaceId, ownerId, service } = fixture;
    const before = await getRecoveryHome({ workspaceId, actorUserId: ownerId, generatedAt: capturedAt });
    await admitA2(fixture);
    const after = await getRecoveryHome({ workspaceId, actorUserId: ownerId, generatedAt: capturedAt });
    assert.deepEqual(after.coverage, before.coverage);
    assert.deepEqual(after.evidenceSources, []);
    const connected = await service.read(workspaceId, ownerId);
    await service.disconnect(workspaceId, ownerId, connected.connection!.revision);
    const revoked = await service.read(workspaceId, ownerId);
    await service.erase(workspaceId, ownerId, revoked.connection!.revision, { noticeVersion: "control-provider-bill-retention-v1", retainAdmitted: true, retainedAdmissionCount: 1 });
    const erased = await getRecoveryHome({ workspaceId, actorUserId: ownerId, generatedAt: capturedAt });
    assert.deepEqual(erased.coverage, before.coverage);
    assert.deepEqual(erased.evidenceSources, []);
  });
});

test("direct SQL provider evidence requires exact original lineage and cannot be paired with substituted grant or snapshot facts", database, async () => {
  await withA2Fixture(async fixture => {
    const { result } = await admitA2(fixture);
    const { pool, workspaceId } = fixture;
    const client = await pool.connect();
    try {
      for (const replacement of [null, { consent_reference: randomUUID() }, { organization_id: "999999" },
        { source_sequence: "9223372036854775807" }, { total_minor: "1" }, { source_fingerprint: "c".repeat(64) }]) {
        await client.query("begin");
        const evidenceId = randomUUID();
        await client.query(`insert into recovery_evidence select (jsonb_populate_record(null::recovery_evidence,
          to_jsonb(evidence) || jsonb_build_object('id',$2::text,'fingerprint',$3::text))).*
          from recovery_evidence evidence where id=$1`, [result.data.reconciliation.evidenceId, evidenceId, randomUUID().replaceAll("-", "").repeat(2)]);
        if (replacement) {
          await assert.rejects(() => client.query(`insert into recovery_provider_bill_links select (jsonb_populate_record(null::recovery_provider_bill_links,
            to_jsonb(link) || $3::jsonb || jsonb_build_object('evidence_id',$2::text))).*
            from recovery_provider_bill_links link where workspace_id=$1`, [workspaceId, evidenceId, JSON.stringify(replacement)]),
            (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "23514"));
        } else {
          await assert.rejects(() => client.query("set constraints all immediate"),
            (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "23514"));
        }
        await client.query("rollback");
      }
      assert.equal((await pool.query("select * from recovery_evidence where workspace_id=$1", [workspaceId])).rowCount, 1);
    } finally { await client.query("rollback"); client.release(); }
  });
});

test("a capture newer than the last completed sync is not admitted as completed source coverage", database, async () => {
  await withA2Fixture(async fixture => {
    const input = await prepareA2(fixture);
    const observed = new Date(capturedAt.getTime() + 60_000);
    const next = (await fixture.pool.query(`insert into zoho_books_snapshots(connection_id,workspace_id,bill_id,fingerprint,bill,change_kind,observed_at,grant_id,organization_id)
      select connection_id,workspace_id,bill_id,$2,bill,'AMENDED',$3,grant_id,organization_id from zoho_books_snapshots where workspace_id=$1 returning sequence`,
      [fixture.workspaceId, "d".repeat(64), observed])).rows[0];
    await fixture.pool.query("update zoho_books_records set latest_sequence=$2 where workspace_id=$1", [fixture.workspaceId, next.sequence]);
    await assert.rejects(() => reconcileCommitmentControlProposal({ ...input, now: observed,
      request: { ...input.request, sourceSequence: next.sequence, expectedLatestSequence: next.sequence } }),
      (error: unknown) => error instanceof RecoveryServiceError && error.code === "INVALID_EVIDENCE");
    assert.equal((await fixture.pool.query("select * from recovery_provider_bill_links where workspace_id=$1", [fixture.workspaceId])).rowCount, 0);
  });
});

test("a human billed comparison does not resolve an older material bill review or follow-up", database, async () => {
  await withA2Fixture(async fixture => {
    const input = await prepareA2(fixture);
    fixture.setBill({ ...initialBill, total: 130, balance: 130, last_modified_time: "2026-09-08T00:00:00+0530" });
    const amendedAt = new Date("2026-09-08T00:00:00.000Z");
    await fixture.service.runDue(amendedAt);
    const material = await fixture.service.read(fixture.workspaceId, fixture.ownerId, { view: "ALL" });
    const nextRequest = { ...input.request, sourceSequence: material.items[0].sequence, expectedLatestSequence: material.items[0].sequence, expectedSourceVersion: material.connection!.revision };
    const result = await reconcileCommitmentControlProposal({ ...input, request: nextRequest, now: amendedAt });
    const brief = await getCommitmentControlBrief({ workspaceId: fixture.workspaceId, actorUserId: fixture.ownerId, now: amendedAt });
    const source = brief.data.proposals[0].reconciliations[0].providerBillSource!;
    assert.equal(source.pendingMaterialOlderCount, 1);
    assert.deepEqual(source.pendingMaterialOlderSequences, [nextRequest.sourceSequence]);
    assert.equal(source.pendingMaterialNewerCount, 0);
    assert.equal(result.data.reconciliation.verdict, "OVER_CAP");
    assert.equal((await fixture.service.detail(fixture.workspaceId, fixture.ownerId, "200001")).events.length, 0);
  });
});

test("current backup and restore preserve populated A2 admissions, bases and integrity even after source erasure", database, async suite => {
  for (const erased of [false, true]) await suite.test(erased ? "source erased" : "source retained", async () => {
    await withA2Fixture(async fixture => {
      const { result } = await admitA2(fixture);
      const { pool, workspaceId, ownerId, service } = fixture;
      if (erased) {
        const source = await service.read(workspaceId, ownerId);
        await service.disconnect(workspaceId, ownerId, source.connection!.revision);
        const revoked = await service.read(workspaceId, ownerId);
        await service.erase(workspaceId, ownerId, revoked.connection!.revision, {
          noticeVersion: "control-provider-bill-retention-v1", retainAdmitted: true, retainedAdmissionCount: 1,
        });
      }
      const sourceUrl = new URL(process.env.DATABASE_URL!);
      assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(sourceUrl.hostname));
      assert.equal(sourceUrl.pathname, `/${fixtureDatabaseName}`);
      const directory = mkdtempSync(join(fixtureArtifactDirectory, "populated-restore-"));
      const dumpPath = join(directory, "synthetic-a2.dump");
      const targetName = `vognary_a2_restore_${randomUUID().replaceAll("-", "")}`;
      const expected = await readRecoveryBackupVerification(pool);
      assert.equal(expected.recoveryWorkspaceCounts.recovery_provider_bill_links, "1");
      const original = (await pool.query("select to_jsonb(link) as record from recovery_provider_bill_links link where workspace_id=$1", [workspaceId])).rows;
      execFileSync("pg_dump", ["--format=custom", "--no-owner", "--no-acl", `--dbname=${sourceUrl.href}`, `--file=${dumpPath}`]);
      await pool.query(`create database "${targetName}"`);
      const targetUrl = new URL(sourceUrl);
      targetUrl.pathname = `/${targetName}`;
      let restored: Pool | undefined;
      try {
        execFileSync("pg_restore", ["--no-owner", "--no-acl", "--exit-on-error", `--dbname=${targetUrl.href}`, dumpPath]);
        restored = new Pool({ connectionString: targetUrl.href, ssl: false });
        const actual = await readRecoveryBackupVerification(restored);
        assert.deepEqual(actual, expected);
        assert.equal(recoveryBackupVerificationMatches(expected, actual), true);
        assert.deepEqual((await restored.query("select to_jsonb(link) as record from recovery_provider_bill_links link where workspace_id=$1", [workspaceId])).rows, original);
        const comparison = (await restored.query("select comparison_kind,decision_amount_basis,observed_evidence_basis,observed_amount_minor::text from commitment_control_reconciliations where id=$1", [result.data.reconciliation.id])).rows[0];
        assert.deepEqual(comparison, { comparison_kind: "BILLED_AMOUNT_COMPARISON", decision_amount_basis: "GROSS_BILLED_TOTAL_PER_CHARGE", observed_evidence_basis: "PROVIDER_BILL_TOTAL", observed_amount_minor: "12345" });
        await assert.rejects(() => restored!.query("update recovery_provider_bill_links set total_minor=1 where workspace_id=$1", [workspaceId]), /immutable/i);
        await restored.query("delete from workspaces where id=$1", [workspaceId]);
        assert.equal((await restored.query("select * from recovery_provider_bill_links where workspace_id=$1", [workspaceId])).rowCount, 0);
        writeFileSync(join(directory, "verification.json"), JSON.stringify({ synthetic: true, sourceErased: erased, expected, actual, exactLineagePreserved: true, workspaceErasurePassed: true }, null, 2));
      } finally {
        await restored?.end();
        await pool.query(`drop database "${targetName}"`);
      }
      console.log(`Synthetic A2 populated restore artifact: ${directory}`);
    });
  });
});









