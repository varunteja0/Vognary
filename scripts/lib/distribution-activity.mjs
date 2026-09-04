const lanes = ["P", "L", "A"];

const channels = [
  "WARM_INTRO",
  "MANUAL_DIRECT",
  "REFERRAL",
  "PARTNER",
  "PHONE",
  "WHATSAPP",
  "LINKEDIN",
  "EMAIL_PERMISSIONED",
  "WEB_FORM",
  "HACKER_NEWS",
  "X",
  "REDDIT",
  "INDIE_HACKERS",
  "COMMUNITY",
  "ROUNDTABLE",
  "OTHER",
];

const eventLanes = {
  MEASUREMENT_STARTED: ["L"],
  MEASUREMENT_COVERAGE_CONFIRMED: ["L"],
  CONTACT_ATTEMPTED: ["P"],
  REPLY_RECEIVED: ["P"],
  CONVERSATION_COMPLETED: ["P"],
  COMMITTED_EVENT_RECORDED: ["P"],
  OFFER_MADE: ["P"],
  INVOICE_COMMITTED: ["P"],
  INVOICE_SENT: ["P"],
  PAYMENT_EVIDENCE_RECORDED: ["P"],
  INTRODUCTION_REQUESTED: ["P"],
  INTRODUCTION_RECEIVED: ["P"],
  OPT_OUT_RECEIVED: ["P"],
  CHANNEL_WARNING: lanes,
  BUYER_LANGUAGE_RECORDED: ["L"],
  OBJECTION_RECORDED: ["L"],
  PUBLIC_ARTIFACT_PUBLISHED: ["A"],
  PUBLIC_REPLY_POSTED: ["A"],
  COMMUNITY_APPLICATION_SUBMITTED: ["A"],
  COMMUNITY_PERMISSION_REQUESTED: ["A"],
  ORGANIZER_PROPOSAL_SUBMITTED: ["A"],
  ROUNDTABLE_SCHEDULED: ["A"],
  ROUNDTABLE_ATTENDANCE: ["A"],
};

const evidenceOrigins = [
  "founder-confirmed",
  "provider-confirmed",
  "public-observation",
  "crm-observation",
  "moderator-confirmed",
];

export const commitmentControlPilotAmountMinor = "1499900";

const purchaseCycleEventTypes = new Set([
  "OFFER_MADE",
  "INVOICE_COMMITTED",
  "INVOICE_SENT",
  "PAYMENT_EVIDENCE_RECORDED",
]);

const allowedFields = new Set([
  "version",
  "event_id",
  "occurred_at_utc",
  "lane",
  "crm_id",
  "node_id",
  "event_type",
  "channel",
  "artifact_ref",
  "coverage_through_utc",
  "evidence_ref",
  "founder_minutes",
  "amount_minor",
  "currency",
  "purchase_ordinal",
  "provider_receipt_ref",
  "source_event_id",
  "evidence_origin",
  "public_summary_safe",
]);

const opaqueReferencePattern = /^[0-9a-f]{64}$/;
const crmIdPattern = /^P\d{2,6}$/;
const currencyPattern = /^[A-Z]{3}$/;
const minorUnitPattern = /^(0|[1-9]\d*)$/;

export function parseDistributionActivityLedger(input) {
  if (typeof input !== "string") throw new Error("Distribution activity ledger must be text.");

  const eventsById = new Map();
  for (const [index, rawLine] of input.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    const lineNumber = index + 1;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      throw new Error(`Distribution activity ledger line ${lineNumber} is not valid JSON.`);
    }
    validateEvent(event, lineNumber);

    const previous = eventsById.get(event.event_id);
    if (previous) {
      if (stableSerialize(previous) !== stableSerialize(event)) {
        throw new Error(`Distribution activity ledger line ${lineNumber} conflicts with duplicate event_id.`);
      }
      continue;
    }
    eventsById.set(event.event_id, Object.freeze({ ...event }));
  }

  const events = [...eventsById.values()];
  validateLineage(events);
  validateNaturalKeys(events);
  validateCommercialSequence(events);
  return events;
}

export function summarizeDistributionActivity(events, window) {
  if (!Array.isArray(events)) throw new Error("Distribution activity events must be an array.");
  const since = canonicalTimestamp(window?.since, "since");
  const asOf = canonicalTimestamp(window?.asOf, "asOf");
  if (Date.parse(since) >= Date.parse(asOf)) {
    throw new Error("Distribution activity window requires since before asOf.");
  }

  const measurementStartedAt = events
    .filter((event) => event.event_type === "MEASUREMENT_STARTED")
    .map((event) => event.occurred_at_utc)
    .sort()[0] ?? null;
  const measurementCoverageThrough = events
    .filter((event) => event.event_type === "MEASUREMENT_COVERAGE_CONFIRMED")
    .map((event) => event.coverage_through_utc)
    .sort()
    .at(-1) ?? null;
  const selected = events.filter((event) => (
    event.event_type !== "MEASUREMENT_STARTED"
    && event.event_type !== "MEASUREMENT_COVERAGE_CONFIRMED"
    && Date.parse(event.occurred_at_utc) >= Date.parse(since)
    && Date.parse(event.occurred_at_utc) < Date.parse(asOf)
  ));
  const fullyMeasured = Boolean(
    measurementStartedAt
    && measurementCoverageThrough
    && measurementStartedAt <= since
    && measurementCoverageThrough >= asOf,
  );
  const coverageOverlaps = Boolean(
    measurementStartedAt
    && measurementCoverageThrough
    && measurementStartedAt < asOf
    && measurementCoverageThrough > since,
  );
  const measurementStatus = fullyMeasured
    ? "MEASURED"
    : selected.length > 0
      ? "RECORDED_ONLY"
      : coverageOverlaps
      ? "PARTIAL"
      : "UNMEASURED";
  const recordedCount = (eventType) => selected.filter((event) => event.event_type === eventType).length;
  const recordedProspectCount = (eventType) => new Set(selected
    .filter((event) => event.event_type === eventType)
    .map((event) => event.crm_id)).size;
  const reportCount = (value) => value > 0 || fullyMeasured ? value : null;
  const effortCoverage = selected.length === 0
    ? fullyMeasured ? "COMPLETE" : "UNMEASURED"
    : selected.every((event) => event.founder_minutes !== undefined)
      ? "COMPLETE"
      : "PARTIAL";
  const totalFounderMinutesValue = selected.reduce(
    (total, event) => total + (event.founder_minutes ?? 0),
    0,
  );
  const firstPaymentEvidenceRecords = selected.filter((event) => (
    event.event_type === "PAYMENT_EVIDENCE_RECORDED" && event.purchase_ordinal === 1
  )).length;
  const repurchaseEvidenceRecords = selected.filter((event) => (
    event.event_type === "PAYMENT_EVIDENCE_RECORDED" && event.purchase_ordinal >= 2
  )).length;

  const commercial = {
    contactsAttempted: reportCount(recordedProspectCount("CONTACT_ATTEMPTED")),
    replies: reportCount(recordedProspectCount("REPLY_RECEIVED")),
    conversations: reportCount(recordedProspectCount("CONVERSATION_COMPLETED")),
    committedEvents: reportCount(recordedProspectCount("COMMITTED_EVENT_RECORDED")),
    offers: reportCount(recordedCount("OFFER_MADE")),
    invoiceCommitments: reportCount(recordedCount("INVOICE_COMMITTED")),
    invoices: reportCount(recordedCount("INVOICE_SENT")),
    firstPaymentEvidenceRecords: reportCount(firstPaymentEvidenceRecords),
    repurchaseEvidenceRecords: reportCount(repurchaseEvidenceRecords),
    introductionsRequested: reportCount(recordedCount("INTRODUCTION_REQUESTED")),
    introductionsReceived: reportCount(recordedCount("INTRODUCTION_RECEIVED")),
    optOuts: reportCount(recordedCount("OPT_OUT_RECEIVED")),
  };

  return {
    measurementStatus,
    measurementStartedAt,
    measurementCoverageThrough,
    window: { since, asOf },
    activity: {
      totalEvents: selected.length,
      byLane: Object.fromEntries(lanes.map((lane) => [
        lane,
        reportCount(selected.filter((event) => event.lane === lane).length),
      ])),
      byChannel: Object.fromEntries(channels.map((channel) => [
        channel,
        reportCount(selected.filter((event) => event.channel === channel).length),
      ])),
    },
    commercial,
    learning: {
      buyerLanguageRecords: reportCount(recordedCount("BUYER_LANGUAGE_RECORDED")),
      objectionsRecorded: reportCount(recordedCount("OBJECTION_RECORDED")),
    },
    audience: {
      artifactsPublished: reportCount(recordedCount("PUBLIC_ARTIFACT_PUBLISHED")),
      publicReplies: reportCount(recordedCount("PUBLIC_REPLY_POSTED")),
      communityApplicationsSubmitted: reportCount(recordedCount("COMMUNITY_APPLICATION_SUBMITTED")),
      communityPermissionRequests: reportCount(recordedCount("COMMUNITY_PERMISSION_REQUESTED")),
      organizerProposalsSubmitted: reportCount(recordedCount("ORGANIZER_PROPOSAL_SUBMITTED")),
      roundtablesScheduled: reportCount(recordedCount("ROUNDTABLE_SCHEDULED")),
      roundtableAttendance: reportCount(recordedCount("ROUNDTABLE_ATTENDANCE")),
    },
    effort: {
      coverage: effortCoverage,
      totalFounderMinutes: effortCoverage === "COMPLETE"
        ? totalFounderMinutesValue
        : null,
      byLane: Object.fromEntries(lanes.map((lane) => [
        lane,
        summarizeLaneMinutes(selected.filter((event) => event.lane === lane), fullyMeasured),
      ])),
    },
  };
}

export function formatDistributionActivityReport(summary) {
  const commercial = summary.measurementStatus === "UNMEASURED"
    ? "Commercial: unmeasured; initialize measurement before interpreting zeroes"
    : `${summary.measurementStatus === "MEASURED" ? "Recorded commercial" : "Partial recorded commercial"}: ${formatCount(summary.commercial.contactsAttempted, "contact attempted", "contacts attempted")} · ${formatCount(summary.commercial.replies, "reply", "replies")} · ${formatCount(summary.commercial.conversations, "conversation", "conversations")} · ${formatCount(summary.commercial.committedEvents, "committed event", "committed events")} · ${formatCount(summary.commercial.offers, "offer", "offers")} · ${formatCount(summary.commercial.firstPaymentEvidenceRecords, "first-payment evidence record", "first-payment evidence records")} · ${formatCount(summary.commercial.repurchaseEvidenceRecords, "repurchase evidence record", "repurchase evidence records")}`;
  return [
    `Distribution activity ${summary.measurementStatus}: ${summary.activity.totalEvents} recorded events in [${summary.window.since}, ${summary.window.asOf})`,
    commercial,
    `Audience: ${formatCount(summary.audience.artifactsPublished, "public artifact published", "public artifacts published")} · ${formatCount(summary.audience.publicReplies, "public reply posted", "public replies posted")} · ${formatCount(summary.audience.communityApplicationsSubmitted, "community application submitted", "community applications submitted")} · ${formatCount(summary.audience.organizerProposalsSubmitted, "organizer proposal submitted", "organizer proposals submitted")} · ${formatCount(summary.audience.roundtablesScheduled, "roundtable scheduled", "roundtables scheduled")} · ${formatCount(summary.audience.roundtableAttendance, "roundtable attendee", "roundtable attendees")}`,
    `Learning: ${formatCount(summary.learning.buyerLanguageRecords, "buyer-language record", "buyer-language records")} · ${formatCount(summary.learning.objectionsRecorded, "objection", "objections")}`,
    `Founder effort ${summary.effort.coverage}: ${formatMinutes(summary.effort.totalFounderMinutes)} · ${formatMinutes(summary.effort.byLane.P, "prospect")} · ${formatMinutes(summary.effort.byLane.L, "learning")} · ${formatMinutes(summary.effort.byLane.A, "audience")}`,
    "This ledger records attributable activity and settlement references. The private CRM plus provider reconciliation remain authoritative for offers, cleared payments, and company gates.",
    "Audience and learning activity never count as commercial evidence.",
  ].join("\n");
}

function validateEvent(event, lineNumber) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new Error(`Distribution activity ledger line ${lineNumber} must be an object.`);
  }
  const unknownField = Object.keys(event).find((field) => !allowedFields.has(field));
  if (unknownField) {
    throw new Error(`Distribution activity ledger line ${lineNumber} has a forbidden field.`);
  }
  if (event.version !== 1) {
    throw new Error(`Distribution activity ledger line ${lineNumber} has unsupported version.`);
  }
  for (const field of ["event_id", "event_type", "channel", "evidence_origin"]) {
    if (typeof event[field] !== "string" || !event[field]) {
      throw new Error(`Distribution activity ledger line ${lineNumber} requires ${field}.`);
    }
  }
  if (!opaqueReferencePattern.test(event.event_id)) {
    throw new Error(`Distribution activity ledger line ${lineNumber} has invalid event_id.`);
  }
  canonicalTimestamp(event.occurred_at_utc, `line ${lineNumber} occurred_at_utc`);
  if (event.event_type === "MEASUREMENT_COVERAGE_CONFIRMED") {
    canonicalTimestamp(event.coverage_through_utc, `line ${lineNumber} coverage_through_utc`);
    if (event.coverage_through_utc > event.occurred_at_utc) {
      throw new Error(`Distribution activity ledger line ${lineNumber} cannot confirm future coverage.`);
    }
  } else if (event.coverage_through_utc !== undefined) {
    throw new Error(`Distribution activity ledger line ${lineNumber} has coverage_through_utc outside a checkpoint.`);
  }
  if (!lanes.includes(event.lane)) {
    throw new Error(`Distribution activity ledger line ${lineNumber} has invalid lane.`);
  }
  if (!Object.hasOwn(eventLanes, event.event_type)) {
    throw new Error(`Distribution activity ledger line ${lineNumber} has invalid event_type.`);
  }
  if (!eventLanes[event.event_type].includes(event.lane)) {
    throw new Error(`Distribution activity ledger line ${lineNumber} cannot record ${event.event_type} in lane ${event.lane}.`);
  }
  if (!channels.includes(event.channel)) {
    throw new Error(`Distribution activity ledger line ${lineNumber} has invalid channel.`);
  }
  if (!evidenceOrigins.includes(event.evidence_origin)) {
    throw new Error(`Distribution activity ledger line ${lineNumber} has invalid evidence_origin.`);
  }
  if (event.public_summary_safe !== true) {
    throw new Error(`Distribution activity ledger line ${lineNumber} requires public_summary_safe=true.`);
  }
  if (event.crm_id !== undefined && !crmIdPattern.test(event.crm_id)) {
    throw new Error(`Distribution activity ledger line ${lineNumber} has invalid crm_id.`);
  }
  for (const field of ["node_id", "artifact_ref", "evidence_ref", "provider_receipt_ref", "source_event_id"]) {
    if (event[field] !== undefined && !opaqueReferencePattern.test(event[field])) {
      throw new Error(`Distribution activity ledger line ${lineNumber} has invalid ${field}.`);
    }
  }
  if (!event.evidence_ref) {
    throw new Error(`Distribution activity ledger line ${lineNumber} requires evidence_ref.`);
  }
  if (event.lane === "P" && event.event_type !== "CHANNEL_WARNING" && !event.crm_id) {
    throw new Error(`Distribution activity ledger line ${lineNumber} requires crm_id for prospect activity.`);
  }
  if (event.founder_minutes !== undefined && !isNonNegativeSafeInteger(event.founder_minutes)) {
    throw new Error(`Distribution activity ledger line ${lineNumber} has invalid founder_minutes.`);
  }
  if (event.amount_minor !== undefined) {
    if (typeof event.amount_minor !== "string" || !minorUnitPattern.test(event.amount_minor)) {
      throw new Error(`Distribution activity ledger line ${lineNumber} has invalid amount_minor.`);
    }
    if (!currencyPattern.test(event.currency ?? "")) {
      throw new Error(`Distribution activity ledger line ${lineNumber} requires currency with amount_minor.`);
    }
  } else if (event.currency !== undefined) {
    throw new Error(`Distribution activity ledger line ${lineNumber} has currency without amount_minor.`);
  }
  if (purchaseCycleEventTypes.has(event.event_type)) {
    if (!Number.isSafeInteger(event.purchase_ordinal) || event.purchase_ordinal < 1) {
      throw new Error(`Distribution activity ledger line ${lineNumber} requires purchase_ordinal for ${event.event_type}.`);
    }
    if (event.amount_minor !== commitmentControlPilotAmountMinor || event.currency !== "INR") {
      throw new Error(`Distribution activity ledger line ${lineNumber} requires the authorized pilot amount in INR.`);
    }
  } else if (event.purchase_ordinal !== undefined) {
    throw new Error(`Distribution activity ledger line ${lineNumber} has purchase_ordinal outside a purchase cycle.`);
  }
  if (event.event_type === "PAYMENT_EVIDENCE_RECORDED") {
    if (event.evidence_origin !== "provider-confirmed") {
      throw new Error(`Distribution activity ledger line ${lineNumber} requires provider-confirmed payment evidence.`);
    }
    if (!event.provider_receipt_ref) {
      throw new Error(`Distribution activity ledger line ${lineNumber} requires provider_receipt_ref for payment.`);
    }
  } else if (event.provider_receipt_ref !== undefined) {
    throw new Error(`Distribution activity ledger line ${lineNumber} has provider_receipt_ref outside payment.`);
  }
}

function validateLineage(events) {
  const byId = new Map(events.map((event) => [event.event_id, event]));
  for (const event of events) {
    if (!event.source_event_id) continue;
    if (event.source_event_id === event.event_id) {
      throw new Error("Distribution activity event cannot reference itself.");
    }
    if (!byId.has(event.source_event_id)) {
      throw new Error("Distribution activity event references an unknown source_event_id.");
    }
  }
}

function validateNaturalKeys(events) {
  const purchaseKeys = new Set();
  const evidenceRefs = new Set();
  const paymentReceiptRefs = new Set();
  const artifactRefs = new Set();
  let measurementStarts = 0;
  let measurementStartedAt = null;
  let previousCoverageThrough = null;
  for (const [index, event] of events.entries()) {
    if (evidenceRefs.has(event.evidence_ref)) {
      throw new Error("Distribution activity ledger contains duplicate evidence_ref.");
    }
    evidenceRefs.add(event.evidence_ref);
    if (event.event_type === "MEASUREMENT_STARTED") {
      measurementStarts += 1;
      measurementStartedAt = event.occurred_at_utc;
      if (index !== 0) {
        throw new Error("Distribution activity MEASUREMENT_STARTED must be the first event.");
      }
      if (measurementStarts > 1) {
        throw new Error("Distribution activity ledger contains duplicate MEASUREMENT_STARTED.");
      }
    }
    if (event.event_type === "MEASUREMENT_COVERAGE_CONFIRMED") {
      if (!measurementStartedAt) {
        throw new Error("Distribution activity coverage checkpoint requires MEASUREMENT_STARTED first.");
      }
      if (event.coverage_through_utc < measurementStartedAt) {
        throw new Error("Distribution activity coverage checkpoint predates measurement start.");
      }
      if (previousCoverageThrough && event.coverage_through_utc <= previousCoverageThrough) {
        throw new Error("Distribution activity coverage checkpoints must advance.");
      }
      previousCoverageThrough = event.coverage_through_utc;
    }
    if (purchaseCycleEventTypes.has(event.event_type)) {
      const key = `${event.crm_id}:${event.event_type}:${event.purchase_ordinal}`;
      if (purchaseKeys.has(key)) {
        throw new Error(`Distribution activity ledger contains duplicate ${event.event_type} for one purchase cycle.`);
      }
      purchaseKeys.add(key);
    }
    if (event.event_type === "PAYMENT_EVIDENCE_RECORDED") {
      if (paymentReceiptRefs.has(event.provider_receipt_ref)) {
        throw new Error("Distribution activity ledger contains duplicate provider_receipt_ref.");
      }
      paymentReceiptRefs.add(event.provider_receipt_ref);
    }
    if (event.event_type === "PUBLIC_ARTIFACT_PUBLISHED") {
      if (!event.artifact_ref) {
        throw new Error("Distribution activity publication requires artifact_ref.");
      }
      if (artifactRefs.has(event.artifact_ref)) {
        throw new Error("Distribution activity ledger contains duplicate artifact_ref.");
      }
      artifactRefs.add(event.artifact_ref);
    }
  }
}

function validateCommercialSequence(events) {
  const chronological = [...events].sort((left, right) => (
    left.occurred_at_utc.localeCompare(right.occurred_at_utc)
    || left.event_id.localeCompare(right.event_id)
  ));
  const recorded = new Set();
  const paidOrdinals = new Map();

  for (const event of chronological) {
    if (!purchaseCycleEventTypes.has(event.event_type)) continue;
    const ordinal = event.purchase_ordinal;
    const cyclePrefix = `${event.crm_id}:${ordinal}`;
    if (event.event_type === "OFFER_MADE") {
      if (ordinal > 1 && !recorded.has(`${event.crm_id}:PAYMENT_EVIDENCE_RECORDED:${ordinal - 1}`)) {
        throw new Error(`Distribution activity purchase ordinal ${ordinal} requires purchase ordinal ${ordinal - 1} payment.`);
      }
    }
    if (event.event_type === "INVOICE_COMMITTED" || event.event_type === "INVOICE_SENT") {
      if (!recorded.has(`${event.crm_id}:OFFER_MADE:${ordinal}`)) {
        throw new Error(`Distribution activity ${event.event_type} requires the same-cycle offer first.`);
      }
    }
    if (event.event_type === "PAYMENT_EVIDENCE_RECORDED") {
      const expectedOrdinal = (paidOrdinals.get(event.crm_id) ?? 0) + 1;
      if (ordinal !== expectedOrdinal) {
        throw new Error(`Distribution activity payment requires purchase ordinal ${expectedOrdinal} first.`);
      }
      if (!recorded.has(`${event.crm_id}:OFFER_MADE:${ordinal}`)) {
        throw new Error("Distribution activity payment requires the same-cycle offer first.");
      }
      if (!recorded.has(`${event.crm_id}:INVOICE_SENT:${ordinal}`)) {
        throw new Error("Distribution activity payment requires the same-cycle invoice first.");
      }
      paidOrdinals.set(event.crm_id, ordinal);
    }
    recorded.add(`${event.crm_id}:${event.event_type}:${ordinal}`);
    recorded.add(`${cyclePrefix}:${event.event_type}`);
  }
}

function canonicalTimestamp(value, field) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new Error(`Distribution activity ${field} must be a canonical UTC timestamp.`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`Distribution activity ${field} must be a valid UTC timestamp.`);
  }
  return value;
}

function isNonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function formatCount(value, singular, plural) {
  if (value === null) return "unmeasured";
  return `${value} ${value === 1 ? singular : plural}`;
}

function formatMinutes(value, label = "recorded min") {
  return value === null ? `${label} unmeasured` : `${value} ${label}`;
}

function summarizeLaneMinutes(events, fullyMeasured) {
  if (events.length === 0) return fullyMeasured ? 0 : null;
  if (events.some((event) => event.founder_minutes === undefined)) return null;
  return events.reduce((total, event) => total + event.founder_minutes, 0);
}