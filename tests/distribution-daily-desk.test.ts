import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildDistributionDailyDesk,
  formatDistributionDailyDesk,
} from "../scripts/lib/distribution-daily-desk.mjs";

test("daily desk chooses permitted routes before unsendable drafts", () => {
  const desk = buildDistributionDailyDesk({
    asOf: "2026-09-03T18:00:00.000Z",
    market: {
      companyGate: { offers: 0, clearedPayments: 0, status: "INCOMPLETE" },
      cells: {
        DIRECT_FINANCE: { replies: 0, conversations: 0 },
        FRACTIONAL_FINANCE: { replies: 0, conversations: 0 },
        FINOPS_AI_OPERATIONS: { replies: 0, conversations: 0 },
      },
    },
    operator: {
      firstTouches: [
        { id: "P01", sendable: false },
        { id: "P02", sendable: false },
      ],
      followUps: [{ id: "P03", sendable: false, notBefore: "2026-09-03" }],
    },
    distribution: {
      measurementStatus: "MEASURED",
      commercial: { introductionsRequested: 0 },
      audience: {
        artifactsPublished: 0,
        publicReplies: 0,
        roundtablesScheduled: 0,
      },
      effort: { coverage: "COMPLETE", totalFounderMinutes: 0 },
    },
  });

  assert.equal(desk.primaryAction, "SECURE_PERMITTED_ROUTES");
  assert.equal(desk.blockedFirstTouches, 2);
  assert.equal(desk.dueSendableFollowUps, 0);
  assert.equal(desk.targets.introductionRequestsRemaining, 10);
  assert.equal(desk.targets.publicArtifactsRemaining, 1);
  assert.equal(desk.targets.publicRepliesRemaining, 3);
  assert.equal(desk.targets.roundtablesRemaining, 1);

  const output = formatDistributionDailyDesk(desk);
  assert.match(output, /Primary action: secure permitted warm, referral, partner, or manual routes/i);
  assert.match(output, /10 introduction requests remaining/i);
  assert.match(output, /3 public replies remaining/i);
  assert.doesNotMatch(output, /P01|P02|P03/);
});

test("daily desk prioritizes substantive replies and due permitted follow-ups", () => {
  const replyDesk = buildDistributionDailyDesk({
    asOf: "2026-09-04T12:00:00.000Z",
    market: {
      companyGate: { offers: 0, clearedPayments: 0, status: "INCOMPLETE" },
      cells: {
        DIRECT_FINANCE: { replies: 2, conversations: 1 },
        FRACTIONAL_FINANCE: { replies: 0, conversations: 0 },
        FINOPS_AI_OPERATIONS: { replies: 0, conversations: 0 },
      },
    },
    operator: {
      firstTouches: [{ id: "P04", sendable: true }],
      followUps: [{ id: "P05", sendable: true, notBefore: "2026-09-04" }],
    },
    distribution: measuredDistribution(),
  });
  assert.equal(replyDesk.primaryAction, "HANDLE_SUBSTANTIVE_REPLIES");

  const followUpDesk = buildDistributionDailyDesk({
    asOf: "2026-09-04T12:00:00.000Z",
    market: {
      companyGate: { offers: 0, clearedPayments: 0, status: "INCOMPLETE" },
      cells: {
        DIRECT_FINANCE: { replies: 1, conversations: 1 },
        FRACTIONAL_FINANCE: { replies: 0, conversations: 0 },
        FINOPS_AI_OPERATIONS: { replies: 0, conversations: 0 },
      },
    },
    operator: {
      firstTouches: [{ id: "P04", sendable: true }],
      followUps: [{ id: "P05", sendable: true, notBefore: "2026-09-04" }],
    },
    distribution: measuredDistribution(),
  });
  assert.equal(followUpDesk.primaryAction, "REVIEW_DUE_FOLLOW_UPS");
  assert.match(formatDistributionDailyDesk(followUpDesk), /review 1 due permitted follow-up/i);
});

test("daily desk CLI reads private sources but prints aggregate actions only", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "vognary-daily-desk-"));
  const crmPath = join(temporaryDirectory, "private-crm.csv");
  const ledgerPath = join(temporaryDirectory, "activity-ledger.jsonl");
  try {
    const crmHeaders = [
      "id", "contact_cohort", "test_cell", "finance_owner_public_url", "operator_scope_count",
      "technology_spend_responsibility", "contact_channel", "founder_minutes", "contacted_at",
      "replied_at", "conversation_at", "repeated_job_status", "job_selected",
      "idea_candidate_observed", "enforcement_requirement", "next_event_committed_at", "offer_at",
      "invoice_commitment_at", "invoice_sent_at", "payment_received_at", "t5_status",
    ];
    const crmValues: Record<string, string> = {
      id: "P01",
      contact_cohort: "QUALIFIED",
      test_cell: "DIRECT_FINANCE",
      repeated_job_status: "UNMEASURED",
      job_selected: "UNMEASURED",
      enforcement_requirement: "UNMEASURED",
      t5_status: "NOT_YET_ELIGIBLE",
    };
    writeFileSync(crmPath, [
      crmHeaders.join(","),
      crmHeaders.map((field) => crmValues[field] ?? "").join(","),
    ].join("\n"), { mode: 0o600 });
    writeFileSync(ledgerPath, [
      ledgerEvent("measurement-start-cli", "2026-09-03T00:00:00.000Z", "MEASUREMENT_STARTED"),
      ledgerEvent("measurement-coverage-cli", "2026-09-04T00:00:00.000Z", "MEASUREMENT_COVERAGE_CONFIRMED"),
    ].join("\n"), { mode: 0o600 });

    const result = runDailyDesk([
      "--crm",
      crmPath,
      "--ledger",
      ledgerPath,
      "--since",
      "2026-09-03T00:00:00.000Z",
      "--as-of",
      "2026-09-04T00:00:00.000Z",
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Primary action: secure permitted warm, referral, partner, or manual routes/i);
    assert.match(result.stdout, /Company gate INCOMPLETE: 0\/10 offers.*0\/2 cleared payments/i);
    assert.doesNotMatch(result.stdout, /P01|private-crm|activity-ledger/);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

function measuredDistribution() {
  return {
    measurementStatus: "MEASURED",
    commercial: { introductionsRequested: 4 },
    audience: {
      artifactsPublished: 1,
      publicReplies: 2,
      roundtablesScheduled: 0,
    },
    effort: { coverage: "COMPLETE", totalFounderMinutes: 35 },
  };
}

function ledgerEvent(label: string, timestamp: string, eventType: string) {
  const value: Record<string, unknown> = {
    version: 1,
    event_id: hash(`event:${label}`),
    occurred_at_utc: timestamp,
    lane: "L",
    event_type: eventType,
    channel: "OTHER",
    evidence_ref: hash(`evidence:${label}`),
    evidence_origin: "founder-confirmed",
    public_summary_safe: true,
  };
  if (eventType === "MEASUREMENT_COVERAGE_CONFIRMED") value.coverage_through_utc = timestamp;
  return JSON.stringify(value);
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function runDailyDesk(arguments_: string[]) {
  return spawnSync(process.execPath, ["scripts/report-distribution-daily.mjs", ...arguments_], {
    cwd: new URL("../", import.meta.url),
    env: { PATH: process.env.PATH ?? "", NODE_ENV: "test" },
    encoding: "utf8",
  });
}