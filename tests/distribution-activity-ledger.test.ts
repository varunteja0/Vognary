import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, linkSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  commitmentControlPilotAmountMinor,
  formatDistributionActivityReport,
  parseDistributionActivityLedger,
  summarizeDistributionActivity,
} from "../scripts/lib/distribution-activity.mjs";
import { commitmentControlPilotOffer } from "../src/lib/pilot-offer";

test("distribution payment evidence is bound to the canonical pilot offer", () => {
  assert.equal(commitmentControlPilotAmountMinor, String(commitmentControlPilotOffer.amountMinor));
  assert.equal(commitmentControlPilotOffer.currency, "INR");
  assert.equal(commitmentControlPilotOffer.billingMode, "ONE_TIME");
});

test("distribution activity labels payment references as evidence rather than cleared-payment truth", () => {
  const source = readFileSync(new URL("../scripts/lib/distribution-activity.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /PAYMENT_CLEARED|firstPayments|repurchases:/);
  assert.match(source, /PAYMENT_EVIDENCE_RECORDED/);
  assert.match(source, /firstPaymentEvidenceRecords/);
  assert.match(source, /repurchaseEvidenceRecords/);
});

test("distribution activity separates commercial proof from audience activity", () => {
  const input = [
    event({
      event_id: "measurement-start-separation-01",
      occurred_at_utc: "2026-09-03T00:00:00.000Z",
      lane: "L",
      event_type: "MEASUREMENT_STARTED",
      channel: "OTHER",
      evidence_origin: "founder-confirmed",
    }),
    event({
      event_id: "event-contact-01",
      occurred_at_utc: "2026-09-03T12:00:00.000Z",
      lane: "P",
      crm_id: "P01",
      event_type: "CONTACT_ATTEMPTED",
      channel: "WARM_INTRO",
      founder_minutes: 12,
      evidence_origin: "founder-confirmed",
    }),
    event({
      event_id: "event-audience-01",
      occurred_at_utc: "2026-09-03T13:00:00.000Z",
      lane: "A",
      event_type: "PUBLIC_ARTIFACT_PUBLISHED",
      channel: "HACKER_NEWS",
      artifact_ref: "artifact-hash-01",
      founder_minutes: 8,
      evidence_origin: "public-observation",
    }),
    event({
      event_id: "event-audience-01",
      occurred_at_utc: "2026-09-03T13:00:00.000Z",
      lane: "A",
      event_type: "PUBLIC_ARTIFACT_PUBLISHED",
      channel: "HACKER_NEWS",
      artifact_ref: "artifact-hash-01",
      founder_minutes: 8,
      evidence_origin: "public-observation",
    }),
    coverageEvent("measurement-coverage-separation-01", "2026-09-04T00:00:00.000Z"),
  ].join("\n");

  const events = parseDistributionActivityLedger(input);
  const summary = summarizeDistributionActivity(events, {
    since: "2026-09-03T00:00:00.000Z",
    asOf: "2026-09-04T00:00:00.000Z",
  });

  assert.equal(events.length, 4);
  assert.equal(summary.activity.totalEvents, 2);
  assert.equal(summary.commercial.contactsAttempted, 1);
  assert.equal(summary.commercial.conversations, 0);
  assert.equal(summary.audience.artifactsPublished, 1);
  assert.equal(summary.effort.totalFounderMinutes, 20);

  const output = formatDistributionActivityReport(summary);
  assert.match(output, /1 contact attempted/);
  assert.match(output, /1 public artifact published/);
  assert.doesNotMatch(output, /P01|artifact-hash-01|founder-confirmed|public-observation/);
});

test("distribution activity counts organizer proposals only as audience distribution", () => {
  const events = parseDistributionActivityLedger([
    event({
      event_id: "organizer-proposal-01",
      occurred_at_utc: "2026-09-04T04:00:00.000Z",
      lane: "A",
      event_type: "ORGANIZER_PROPOSAL_SUBMITTED",
      channel: "WEB_FORM",
      evidence_origin: "public-observation",
    }),
    event({
      event_id: "organizer-proposal-02",
      occurred_at_utc: "2026-09-04T04:01:00.000Z",
      lane: "A",
      event_type: "ORGANIZER_PROPOSAL_SUBMITTED",
      channel: "WEB_FORM",
      evidence_origin: "public-observation",
    }),
  ].join("\n"));
  const summary = summarizeDistributionActivity(events, {
    since: "2026-09-04T00:00:00.000Z",
    asOf: "2026-09-05T00:00:00.000Z",
  });

  assert.equal(summary.audience.organizerProposalsSubmitted, 2);
  assert.equal(summary.commercial.contactsAttempted, null);
  assert.equal(summary.commercial.offers, null);
  assert.match(formatDistributionActivityReport(summary), /2 organizer proposals submitted/i);
});

test("distribution activity records community applications without claiming acceptance", () => {
  const events = parseDistributionActivityLedger(event({
    event_id: "community-application-01",
    occurred_at_utc: "2026-09-04T05:00:00.000Z",
    lane: "A",
    event_type: "COMMUNITY_APPLICATION_SUBMITTED",
    channel: "COMMUNITY",
    evidence_origin: "public-observation",
  }));
  const summary = summarizeDistributionActivity(events, {
    since: "2026-09-04T00:00:00.000Z",
    asOf: "2026-09-05T00:00:00.000Z",
  });

  assert.equal(summary.audience.communityApplicationsSubmitted, 1);
  assert.equal(summary.commercial.contactsAttempted, null);
  assert.equal(summary.commercial.conversations, null);
  assert.match(formatDistributionActivityReport(summary), /1 community application submitted/i);
});

test("distribution activity rejects privacy leaks and commercial events outside the prospect lane", () => {
  assert.throws(
    () => parseDistributionActivityLedger(event({
      event_id: "event-private-01",
      occurred_at_utc: "2026-09-03T12:00:00.000Z",
      lane: "P",
      crm_id: "P01",
      event_type: "CONTACT_ATTEMPTED",
      channel: "WARM_INTRO",
      evidence_origin: "founder-confirmed",
      email: "person@example.test",
    })),
    /forbidden field/i,
  );
  assert.throws(
    () => parseDistributionActivityLedger(event({
      event_id: "event-inflated-01",
      occurred_at_utc: "2026-09-03T12:00:00.000Z",
      lane: "A",
      event_type: "CONVERSATION_COMPLETED",
      channel: "ROUNDTABLE",
      evidence_origin: "founder-confirmed",
    })),
    /cannot record CONVERSATION_COMPLETED in lane A/i,
  );
  assert.throws(
    () => parseDistributionActivityLedger(event({
      event_id: "event-minutes-01",
      occurred_at_utc: "2026-09-03T12:00:00.000Z",
      lane: "A",
      event_type: "PUBLIC_REPLY_POSTED",
      channel: "X",
      founder_minutes: 1.5,
      evidence_origin: "public-observation",
    })),
    /invalid founder_minutes/i,
  );
});

test("distribution activity treats exact duplicate IDs as idempotent and rejects conflicts", () => {
  const original = event({
    event_id: "event-duplicate-01",
    occurred_at_utc: "2026-09-03T12:00:00.000Z",
    lane: "A",
    event_type: "PUBLIC_REPLY_POSTED",
    channel: "X",
    evidence_origin: "public-observation",
  });
  const conflict = event({
    event_id: "event-duplicate-01",
    occurred_at_utc: "2026-09-03T12:01:00.000Z",
    lane: "A",
    event_type: "PUBLIC_REPLY_POSTED",
    channel: "X",
    evidence_origin: "public-observation",
  });

  assert.equal(parseDistributionActivityLedger(`${original}\n${original}`).length, 1);
  assert.throws(
    () => parseDistributionActivityLedger(`${original}\n${conflict}`),
    /conflicts with duplicate event_id/i,
  );
});

test("distribution activity uses a half-open window and keeps repurchases separate", () => {
  const events = parseDistributionActivityLedger([
    purchaseEvent("event-offer-01", "2026-09-02T22:00:00.000Z", "OFFER_MADE", 1),
    purchaseEvent("event-invoice-01", "2026-09-02T23:00:00.000Z", "INVOICE_SENT", 1),
    payment("event-payment-01", "2026-09-03T00:00:00.000Z", 1),
    purchaseEvent("event-offer-02", "2026-09-03T00:00:01.000Z", "OFFER_MADE", 2),
    purchaseEvent("event-invoice-02", "2026-09-03T00:00:02.000Z", "INVOICE_SENT", 2),
    payment("event-payment-02", "2026-09-03T23:59:00.000Z", 2),
    purchaseEvent("event-offer-03", "2026-09-03T23:59:10.000Z", "OFFER_MADE", 3),
    purchaseEvent("event-invoice-03", "2026-09-03T23:59:20.000Z", "INVOICE_SENT", 3),
    payment("event-payment-03", "2026-09-04T00:00:00.000Z", 3),
  ].join("\n"));
  const summary = summarizeDistributionActivity(events, {
    since: "2026-09-03T00:00:00.000Z",
    asOf: "2026-09-04T00:00:00.000Z",
  });

  assert.equal(summary.activity.totalEvents, 6);
  assert.equal(summary.commercial.firstPaymentEvidenceRecords, 1);
  assert.equal(summary.commercial.repurchaseEvidenceRecords, 1);
});

test("distribution activity refuses invented payments and duplicate commercial facts", () => {
  assert.throws(
    () => parseDistributionActivityLedger(event({
      event_id: "event-zero-payment-01",
      occurred_at_utc: "2026-09-03T12:00:00.000Z",
      lane: "P",
      crm_id: "P01",
      event_type: "PAYMENT_EVIDENCE_RECORDED",
      channel: "MANUAL_DIRECT",
      amount_minor: "0",
      currency: "INR",
      purchase_ordinal: 1,
      evidence_origin: "provider-confirmed",
    })),
    /authorized pilot amount/i,
  );
  assert.throws(
    () => parseDistributionActivityLedger(event({
      event_id: "event-weak-payment-01",
      occurred_at_utc: "2026-09-03T12:00:00.000Z",
      lane: "P",
      crm_id: "P01",
      event_type: "PAYMENT_EVIDENCE_RECORDED",
      channel: "MANUAL_DIRECT",
      amount_minor: "1499900",
      currency: "INR",
      purchase_ordinal: 1,
      evidence_origin: "moderator-confirmed",
    })),
    /provider-confirmed/i,
  );
  assert.throws(
    () => parseDistributionActivityLedger(payment("event-lone-repurchase-01", "2026-09-03T12:00:00.000Z", 2)),
    /purchase ordinal 1/i,
  );

  assert.throws(
    () => parseDistributionActivityLedger(JSON.stringify({
      version: 1,
      event_id: opaqueRef("event-amountless-offer-01"),
      occurred_at_utc: "2026-09-03T12:00:00.000Z",
      lane: "P",
      crm_id: "P01",
      event_type: "OFFER_MADE",
      channel: "MANUAL_DIRECT",
      purchase_ordinal: 1,
      evidence_ref: opaqueRef("offer-proof-01"),
      evidence_origin: "founder-confirmed",
      public_summary_safe: true,
    })),
    /authorized pilot amount/i,
  );

  const duplicatedOffer = [
    purchaseEvent("event-offer-duplicate-01", "2026-09-03T12:00:00.000Z", "OFFER_MADE", 1),
    purchaseEvent("event-offer-duplicate-02", "2026-09-03T12:01:00.000Z", "OFFER_MADE", 1),
  ].join("\n");
  assert.throws(
    () => parseDistributionActivityLedger(duplicatedOffer),
    /duplicate OFFER_MADE/i,
  );

  const duplicatedArtifact = [
    event({
      event_id: "event-artifact-01",
      occurred_at_utc: "2026-09-03T12:00:00.000Z",
      lane: "A",
      event_type: "PUBLIC_ARTIFACT_PUBLISHED",
      channel: "HACKER_NEWS",
      artifact_ref: "artifact-shared-01",
      evidence_origin: "public-observation",
    }),
    event({
      event_id: "event-artifact-02",
      occurred_at_utc: "2026-09-03T12:01:00.000Z",
      lane: "A",
      event_type: "PUBLIC_ARTIFACT_PUBLISHED",
      channel: "X",
      artifact_ref: "artifact-shared-01",
      evidence_origin: "public-observation",
    }),
  ].join("\n");
  assert.throws(
    () => parseDistributionActivityLedger(duplicatedArtifact),
    /duplicate artifact_ref/i,
  );


  const duplicateIntroductionEvidence = [
    event({
      event_id: "event-introduction-01",
      occurred_at_utc: "2026-09-03T12:00:00.000Z",
      lane: "P",
      crm_id: "P01",
      event_type: "INTRODUCTION_REQUESTED",
      channel: "WARM_INTRO",
      evidence_ref: "shared-introduction-proof",
      evidence_origin: "founder-confirmed",
    }),
    event({
      event_id: "event-introduction-02",
      occurred_at_utc: "2026-09-03T12:01:00.000Z",
      lane: "P",
      crm_id: "P01",
      event_type: "INTRODUCTION_REQUESTED",
      channel: "WARM_INTRO",
      evidence_ref: "shared-introduction-proof",
      evidence_origin: "founder-confirmed",
    }),
  ].join("\n");
  assert.throws(
    () => parseDistributionActivityLedger(duplicateIntroductionEvidence),
    /duplicate evidence_ref/i,
  );
});

test("distribution activity distinguishes unmeasured from measured zero", () => {
  const unmeasured = summarizeDistributionActivity([], {
    since: "2026-09-03T00:00:00.000Z",
    asOf: "2026-09-04T00:00:00.000Z",
  });
  assert.equal(unmeasured.measurementStatus, "UNMEASURED");
  assert.equal(unmeasured.commercial.contactsAttempted, null);
  assert.match(formatDistributionActivityReport(unmeasured), /Commercial: unmeasured/i);

  const measured = summarizeDistributionActivity(parseDistributionActivityLedger([
    event({
      event_id: "measurement-start-01",
      occurred_at_utc: "2026-09-03T00:00:00.000Z",
      lane: "L",
      event_type: "MEASUREMENT_STARTED",
      channel: "OTHER",
      evidence_origin: "founder-confirmed",
    }),
    coverageEvent("measurement-coverage-01", "2026-09-04T00:00:00.000Z"),
  ].join("\n")), {
    since: "2026-09-03T00:00:00.000Z",
    asOf: "2026-09-04T00:00:00.000Z",
  });
  assert.equal(measured.measurementStatus, "MEASURED");
  assert.equal(measured.commercial.contactsAttempted, 0);

  const retrospective = [
    event({
      event_id: "record-before-marker-01",
      occurred_at_utc: "2026-09-03T12:00:00.000Z",
      lane: "A",
      event_type: "PUBLIC_REPLY_POSTED",
      channel: "X",
      evidence_origin: "public-observation",
    }),
    event({
      event_id: "late-measurement-start-01",
      occurred_at_utc: "2026-09-03T00:00:00.000Z",
      lane: "L",
      event_type: "MEASUREMENT_STARTED",
      channel: "OTHER",
      evidence_origin: "founder-confirmed",
    }),
  ].join("\n");
  assert.throws(
    () => parseDistributionActivityLedger(retrospective),
    /MEASUREMENT_STARTED must be the first event/i,
  );
});

test("distribution activity bounds zeroes by checkpoints and exposes partial effort coverage", () => {
  const events = parseDistributionActivityLedger([
    event({
      event_id: "measurement-start-effort-01",
      occurred_at_utc: "2026-09-03T00:00:00.000Z",
      lane: "L",
      event_type: "MEASUREMENT_STARTED",
      channel: "OTHER",
      evidence_origin: "founder-confirmed",
    }),
    event({
      event_id: "contact-without-minutes-01",
      occurred_at_utc: "2026-09-03T12:00:00.000Z",
      lane: "P",
      crm_id: "P01",
      event_type: "CONTACT_ATTEMPTED",
      channel: "WARM_INTRO",
      evidence_origin: "founder-confirmed",
    }),
    coverageEvent("measurement-coverage-effort-01", "2026-09-04T00:00:00.000Z"),
  ].join("\n"));

  const covered = summarizeDistributionActivity(events, {
    since: "2026-09-03T00:00:00.000Z",
    asOf: "2026-09-04T00:00:00.000Z",
  });
  assert.equal(covered.measurementStatus, "MEASURED");
  assert.equal(covered.commercial.contactsAttempted, 1);
  assert.equal(covered.effort.coverage, "PARTIAL");
  assert.equal(covered.effort.totalFounderMinutes, null);
  assert.equal(covered.effort.byLane.P, null);

  const future = summarizeDistributionActivity(events, {
    since: "2030-01-01T00:00:00.000Z",
    asOf: "2030-01-02T00:00:00.000Z",
  });
  assert.equal(future.measurementStatus, "UNMEASURED");
  assert.equal(future.commercial.contactsAttempted, null);
  assert.equal(future.audience.artifactsPublished, null);
  assert.equal(future.effort.totalFounderMinutes, null);
});

test("distribution activity accepts only opaque references and does not echo rejected values", () => {
  let error: unknown;
  try {
    parseDistributionActivityLedger(JSON.stringify({
      version: 1,
      event_id: "Alice.Smith",
      occurred_at_utc: "2026-09-03T12:00:00.000Z",
      lane: "P",
      crm_id: "15551234567",
      event_type: "CONTACT_ATTEMPTED",
      channel: "WARM_INTRO",
      evidence_origin: "founder-confirmed",
      public_summary_safe: true,
    }));
  } catch (caught) {
    error = caught;
  }
  assert.ok(error instanceof Error);
  assert.match(error.message, /invalid event_id/i);
  assert.doesNotMatch(error.message, /Alice|Smith|15551234567/);
});

test("distribution report CLI uses an explicit window and fails closed without its ledger", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "vognary-distribution-"));
  const ledgerPath = join(temporaryDirectory, "activity-ledger.jsonl");
  try {
    writeFileSync(ledgerPath, `${event({
      event_id: "event-cli-01",
      occurred_at_utc: "2026-09-03T14:00:00.000Z",
      lane: "P",
      crm_id: "P99",
      event_type: "INTRODUCTION_REQUESTED",
      channel: "WARM_INTRO",
      founder_minutes: 5,
      evidence_origin: "founder-confirmed",
    })}\n`, { mode: 0o600 });

    const result = runReport([
      "--ledger",
      ledgerPath,
      "--since",
      "2026-09-03T00:00:00.000Z",
      "--as-of",
      "2026-09-04T00:00:00.000Z",
      "--json",
    ]);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout) as {
      commercial: { introductionsRequested: number };
      effort: { totalFounderMinutes: number };
    };
    assert.equal(report.commercial.introductionsRequested, 1);
    assert.equal(report.effort.totalFounderMinutes, 5);
    assert.doesNotMatch(result.stdout, /P99|event-cli-01|activity-ledger\.jsonl/);

    const privatePathFragment = "Alice.Smith";
    const missing = runReport([
      "--ledger",
      join(temporaryDirectory, `${privatePathFragment}.jsonl`),
      "--since",
      "2026-09-03T00:00:00.000Z",
      "--as-of",
      "2026-09-04T00:00:00.000Z",
    ]);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /ledger could not be read/i);
    assert.doesNotMatch(missing.stderr, new RegExp(privatePathFragment));
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("distribution log CLI appends one private event idempotently and refuses conflicts", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "vognary-distribution-log-"));
  const ledgerPath = join(temporaryDirectory, "activity-ledger.jsonl");
  const eventPath = join(temporaryDirectory, "next-event.json");
  const original = event({
    event_id: "event-log-01",
    occurred_at_utc: "2026-09-03T15:00:00.000Z",
    lane: "P",
    crm_id: "P77",
    event_type: "INTRODUCTION_REQUESTED",
    channel: "WARM_INTRO",
    founder_minutes: 4,
    evidence_origin: "founder-confirmed",
  });
  try {
    writeFileSync(eventPath, `${original}\n`, { mode: 0o600 });
    const first = runLog(["--ledger", ledgerPath, "--event-file", eventPath]);
    assert.equal(first.status, 0, first.stderr);
    assert.doesNotMatch(first.stdout, /P77|event-log-01/);
    assert.equal(parseDistributionActivityLedger(readFileSync(ledgerPath, "utf8")).length, 1);
    assert.equal(statSync(ledgerPath).mode & 0o777, 0o600);

    const replay = runLog(["--ledger", ledgerPath, "--event-file", eventPath]);
    assert.equal(replay.status, 0, replay.stderr);
    assert.equal(parseDistributionActivityLedger(readFileSync(ledgerPath, "utf8")).length, 1);

    writeFileSync(eventPath, `${event({
      ...JSON.parse(original),
      occurred_at_utc: "2026-09-03T15:01:00.000Z",
    })}\n`, { mode: 0o600 });
    const conflict = runLog(["--ledger", ledgerPath, "--event-file", eventPath]);
    assert.notEqual(conflict.status, 0);
    assert.match(conflict.stderr, /conflicts with duplicate event_id/i);
    assert.equal(parseDistributionActivityLedger(readFileSync(ledgerPath, "utf8")).length, 1);

    const privatePathFragment = "Alice.Smith";
    const missing = runLog([
      "--ledger",
      ledgerPath,
      "--event-file",
      join(temporaryDirectory, `${privatePathFragment}.json`),
    ]);
    assert.notEqual(missing.status, 0);
    assert.doesNotMatch(missing.stderr, new RegExp(privatePathFragment));
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("distribution log cannot bypass a ledger lock through a symlink alias", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "vognary-distribution-lock-"));
  const ledgerPath = join(temporaryDirectory, "activity-ledger.jsonl");
  const aliasPath = join(temporaryDirectory, "ledger-alias.jsonl");
  const eventPath = join(temporaryDirectory, "next-event.json");
  try {
    writeFileSync(ledgerPath, "", { mode: 0o600 });
    symlinkSync(ledgerPath, aliasPath);
    writeFileSync(`${ledgerPath}.lock`, "locked\n", { mode: 0o600 });
    writeFileSync(eventPath, `${event({
      event_id: "event-lock-bypass-01",
      occurred_at_utc: "2026-09-03T15:00:00.000Z",
      lane: "A",
      event_type: "PUBLIC_REPLY_POSTED",
      channel: "X",
      evidence_origin: "public-observation",
    })}\n`, { mode: 0o600 });

    const result = runLog(["--ledger", aliasPath, "--event-file", eventPath]);
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(ledgerPath, "utf8"), "");
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("distribution log cannot bypass a ledger lock through a hard-link alias", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "vognary-distribution-hardlink-"));
  const ledgerPath = join(temporaryDirectory, "activity-ledger.jsonl");
  const aliasPath = join(temporaryDirectory, "ledger-alias.jsonl");
  const eventPath = join(temporaryDirectory, "next-event.json");
  try {
    writeFileSync(ledgerPath, "", { mode: 0o600 });
    linkSync(ledgerPath, aliasPath);
    writeFileSync(`${ledgerPath}.lock`, "locked\n", { mode: 0o600 });
    writeFileSync(eventPath, `${event({
      event_id: "event-hardlink-bypass-01",
      occurred_at_utc: "2026-09-03T15:00:00.000Z",
      lane: "A",
      event_type: "PUBLIC_REPLY_POSTED",
      channel: "X",
      evidence_origin: "public-observation",
    })}\n`, { mode: 0o600 });

    const result = runLog(["--ledger", aliasPath, "--event-file", eventPath]);
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(ledgerPath, "utf8"), "");
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("distribution log never reopens a swapped ledger path after acquiring its lock", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "vognary-distribution-swap-"));
  const ledgerPath = join(temporaryDirectory, "activity-ledger.jsonl");
  const originalPath = join(temporaryDirectory, "original-ledger.jsonl");
  const redirectPath = join(temporaryDirectory, "redirect-target.jsonl");
  const eventPath = join(temporaryDirectory, "next-event.json");
  try {
    const existing = Array.from({ length: 3_000 }, (_, index) => event({
      event_id: `existing-event-${index}`,
      occurred_at_utc: "2026-09-03T15:00:00.000Z",
      lane: "A",
      event_type: "PUBLIC_REPLY_POSTED",
      channel: "X",
      evidence_origin: "public-observation",
    })).join("\n");
    writeFileSync(ledgerPath, `${existing}\n`, { mode: 0o600 });
    writeFileSync(redirectPath, "", { mode: 0o600 });
    writeFileSync(eventPath, `${event({
      event_id: "event-after-path-swap-01",
      occurred_at_utc: "2026-09-03T15:01:00.000Z",
      lane: "A",
      event_type: "PUBLIC_REPLY_POSTED",
      channel: "X",
      evidence_origin: "public-observation",
    })}\n`, { mode: 0o600 });

    const child = spawnLog(["--ledger", ledgerPath, "--event-file", eventPath]);
    await waitForPath(`${ledgerPath}.lock`);
    renameSync(ledgerPath, originalPath);
    symlinkSync(redirectPath, ledgerPath);
    const result = await child;

    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(redirectPath, "utf8"), "");
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

function event(overrides: Record<string, unknown>) {
  const normalized = {
    version: 1,
    public_summary_safe: true,
    ...overrides,
  } as Record<string, unknown>;
  if (!normalized.evidence_ref && normalized.event_id) {
    normalized.evidence_ref = opaqueRef(`evidence:${normalized.event_id}`);
  }
  for (const field of ["event_id", "node_id", "artifact_ref", "evidence_ref", "provider_receipt_ref", "source_event_id"]) {
    if (typeof normalized[field] === "string" && !/^[0-9a-f]{64}$/.test(normalized[field])) {
      normalized[field] = opaqueRef(normalized[field]);
    }
  }
  return JSON.stringify(normalized);
}

function payment(eventId: string, occurredAtUtc: string, purchaseOrdinal: number) {
  return event({
    event_id: eventId,
    occurred_at_utc: occurredAtUtc,
    lane: "P",
    crm_id: "P01",
    event_type: "PAYMENT_EVIDENCE_RECORDED",
    channel: "MANUAL_DIRECT",
    amount_minor: "1499900",
    currency: "INR",
    purchase_ordinal: purchaseOrdinal,
    provider_receipt_ref: `${eventId}-receipt`,
    evidence_origin: "provider-confirmed",
  });
}

function purchaseEvent(
  eventId: string,
  occurredAtUtc: string,
  eventType: "OFFER_MADE" | "INVOICE_SENT",
  purchaseOrdinal: number,
) {
  return event({
    event_id: eventId,
    occurred_at_utc: occurredAtUtc,
    lane: "P",
    crm_id: "P01",
    event_type: eventType,
    channel: "MANUAL_DIRECT",
    amount_minor: "1499900",
    currency: "INR",
    purchase_ordinal: purchaseOrdinal,
    evidence_origin: "founder-confirmed",
  });
}

function coverageEvent(eventId: string, coverageThroughUtc: string) {
  return event({
    event_id: eventId,
    occurred_at_utc: coverageThroughUtc,
    coverage_through_utc: coverageThroughUtc,
    lane: "L",
    event_type: "MEASUREMENT_COVERAGE_CONFIRMED",
    channel: "OTHER",
    evidence_origin: "founder-confirmed",
  });
}

function runReport(arguments_: string[]) {
  return spawnSync(process.execPath, ["scripts/report-distribution.mjs", ...arguments_], {
    cwd: new URL("../", import.meta.url),
    env: { PATH: process.env.PATH ?? "", NODE_ENV: "test" },
    encoding: "utf8",
  });
}

function runLog(arguments_: string[]) {
  return spawnSync(process.execPath, ["scripts/log-distribution-activity.mjs", ...arguments_], {
    cwd: new URL("../", import.meta.url),
    env: { PATH: process.env.PATH ?? "", NODE_ENV: "test" },
    encoding: "utf8",
  });
}

function spawnLog(arguments_: string[]) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolvePromise) => {
    const child = spawn(process.execPath, ["scripts/log-distribution-activity.mjs", ...arguments_], {
      cwd: new URL("../", import.meta.url),
      env: { PATH: process.env.PATH ?? "", NODE_ENV: "test" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolvePromise({ status, stdout, stderr }));
  });
}

async function waitForPath(path: string) {
  const deadline = Date.now() + 5_000;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for the private ledger lock.");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1));
  }
}

function opaqueRef(value: unknown) {
  return createHash("sha256").update(String(value)).digest("hex");
}