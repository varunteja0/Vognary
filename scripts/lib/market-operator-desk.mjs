import { parseCsvRows } from "./market-test-report.mjs";

const marketTestCells = new Set([
  "DIRECT_FINANCE",
  "FRACTIONAL_FINANCE",
  "FINOPS_AI_OPERATIONS",
]);

const contactChannels = new Set([
  "WARM_INTRO",
  "MANUAL_DIRECT",
  "REFERRAL",
  "PARTNER",
  "OTHER",
]);

const progressedStatuses = new Set([
  "conversation",
  "offered",
  "invoice-sent",
  "paid-pilot",
  "active-pilot",
  "renewed",
  "closed-lost",
  "refunded",
]);

const prospectingStatuses = new Set(["", "sourced", "qualified", "contacted"]);

const progressFields = [
  "replied_at",
  "conversation_at",
  "offer_at",
  "invoice_commitment_at",
  "invoice_sent_at",
  "payment_received_at",
  "renewal_offered_at",
  "renewal_paid_at",
];

const pilotOfferText = "INR 14,999 one-time for one pilot month: one policy setup, up to 10 proposals, up to four weekly 30-minute reconciliation reviews, and up to two additional founder-support hours. A second month requires a separate purchase; there is no automatic renewal. Payment does not activate service or customer data. Independent assessment and retest, written activation conditions and feasible service capacity must be confirmed. A full refund can be requested before the pilot starts or if activation misses ten business days after payment. After work begins, applicable law controls. Current tax and legal terms: https://www.vognary.com/pay.";

const messageVariants = [
  {
    key: "AI_SPEND_CHANGE_CONTROL",
    label: "AI spend change control",
  },
  {
    key: "AI_SPEND_APPROVAL_OUTCOME_RECORD",
    label: "AI spend approval and outcome record",
  },
  {
    key: "AI_COST_RECOVERY_NEXT_CYCLE_CONTROL",
    label: "AI cost recovery into next-cycle control",
  },
];

const eventPrompts = {
  DIRECT_FINANCE: "AI, cloud, or software cost your company had to approve before it became a bill",
  FRACTIONAL_FINANCE: "technology-cost decision you helped a client govern",
  FINOPS_AI_OPERATIONS: "AI or cloud cost change that needed an owner or cap before deployment",
};

const sendLogHeaders = [
  "crm_id",
  "cell",
  "channel",
  "touch_type",
  "message_variant",
  "not_before",
  "sent_at",
  "replied_at",
  "reply_verbatim",
  "outcome",
];

export function buildMarketOperatorDesk(rows) {
  const selected = rows.filter((row) => marketTestCells.has(row.test_cell));
  const prospecting = selected.filter((row) => prospectingStatuses.has(row.status || "")
    && !progressFields.some((field) => present(row[field]))
    && !present(row.loss_reason)
    && !present(row.payment_amount_inr));
  const firstTouches = prospecting
    .filter((row) => !present(row.contacted_at))
    .map((row) => buildFirstTouch(row));
  const followUps = prospecting
    .filter((row) => present(row.contacted_at))
    .map((row) => buildFollowUp(row));
  const customerActions = rows.map(buildCustomerAction).filter((action) => action !== null);
  const customerActionCounts = Object.fromEntries(customerActions.map((entry) => [entry.action, 0]));
  for (const entry of customerActions) {
    customerActionCounts[entry.action] = (customerActionCounts[entry.action] ?? 0) + 1;
  }
  const logEntries = [
    ...firstTouches.map((entry) => ({ ...entry, touchType: "FIRST_TOUCH", notBefore: "" })),
    ...followUps.map((entry) => ({ ...entry, touchType: "DAY_3_FOLLOW_UP" })),
  ];

  return {
    firstTouches,
    followUps,
    logEntries,
    customerActions,
    customerGuide: formatCustomerGuide(customerActions),
    interviewGuide: formatInterviewGuide(),
    summary: {
      selectedRows: selected.length,
      firstTouchDrafts: firstTouches.length,
      firstTouchSendable: firstTouches.filter((entry) => entry.sendable).length,
      pendingFollowUps: followUps.length,
      followUpsWithRecordedChannel: followUps.filter((entry) => entry.sendable).length,
      customerActions: customerActions.length,
      customerActionCounts,
      variants: Object.fromEntries(messageVariants.map(({ key }) => [
        key,
        firstTouches.filter((entry) => entry.messageVariant === key).length,
      ])),
    },
  };
}

function buildCustomerAction(row) {
  const action = (key, ownerRole, instruction) => ({
    id: row.id,
    cell: row.test_cell || "UNASSIGNED",
    action: key,
    ownerRole,
    instruction,
    automatic: false,
  });
  const reconcile = (instruction) => action("RECONCILE_CUSTOMER_RECORD", "FOUNDER_OPERATIONS_OWNER", instruction);
  if (row.status === "refunded") {
    return action("RECONCILE_REFUND", "FOUNDER_PAYMENT_OWNER",
      "Verify the native refund and remaining service obligations. Do not resume prospecting or count refunded cash as retained revenue.");
  }
  if (row.status === "closed-lost" || present(row.loss_reason)) {
    return action("REVIEW_LOSS", "FOUNDER",
      "Review the recorded loss internally and respect the decline. Do not generate outreach or infer that silence was a price rejection.");
  }
  if (!prospectingStatuses.has(row.status || "") && !progressedStatuses.has(row.status)) {
    return reconcile("The recorded status is unknown. Reconcile it against the canonical CRM states and native evidence before any new outreach or customer action.");
  }
  if (progressFields.some((field) => present(row[field]) && !isRecordedTimestamp(row[field]))) {
    return reconcile("A recorded lifecycle timestamp is invalid. Correct it from native evidence; do not infer sequence, payment, eligibility or a follow-up date.");
  }
  const hasPaymentStage = ["paid-pilot", "active-pilot", "renewed"].includes(row.status)
    || present(row.payment_received_at)
    || present(row.payment_amount_inr)
    || present(row.renewal_offered_at)
    || present(row.renewal_paid_at);
  if (hasPaymentStage && (!present(row.payment_received_at) || row.payment_amount_inr !== "14999")) {
    return action("RECONCILE_PAYMENT_EVIDENCE", "FOUNDER_PAYMENT_OWNER",
      "The record lacks a valid first-payment timestamp or the unchanged pilot amount. Reconcile native payment, tax and refund evidence; a status, invoice or partial amount does not establish cleared payment or activation.");
  }
  if (!marketTestCells.has(row.test_cell)
    && (hasPaymentStage || progressedStatuses.has(row.status) || progressFields.some((field) => present(row[field])))) {
    return reconcile("Confirm this record belongs to the current Commitment Control thesis and assign its buyer cell. Historical or unassigned activity is not current-thesis acquisition or retention proof.");
  }
  const statusEvidence = {
    conversation: "conversation_at",
    offered: "offer_at",
    "invoice-sent": "invoice_sent_at",
    renewed: "renewal_paid_at",
  };
  if (statusEvidence[row.status] && !present(row[statusEvidence[row.status]])) {
    return reconcile("The recorded status lacks its supporting event timestamp. Reconcile the original receipt or buyer exchange without backfilling an invented event.");
  }
  if (hasPaymentStage) {
    if (present(row.renewal_paid_at)) {
      return action("REVIEW_REPEAT_USE", "FOUNDER_CUSTOMER_SUCCESS_OWNER",
        "Verify the separate repurchase receipt and current eligibility, then review the next decision and return use. Record support time and consent before any referral request. A second purchase is not ARR or proof of retained use.");
    }
    if (present(row.renewal_offered_at)) {
      return action("RECONCILE_REPEAT_PURCHASE", "FOUNDER_PAYMENT_OWNER",
        "Reconcile the buyer's answer and any separate cleared repurchase. An offered second month does not renew entitlement; never auto-charge or continue service from silence.");
    }
    if (row.status !== "active-pilot") {
      return action("REVIEW_ACTIVATION_GATES", "FOUNDER_AND_RELEASE_OWNER",
        "Verify the native cleared receipt. Payment does not activate customer data: independent assessment and retest, release clearance, accepted service capacity and written activation conditions are still required. Review the ten-business-day activation and refund obligation; do not invent a start date.");
    }
    if (!/^(0|[1-9]\d*)$/.test(row.proposal_count ?? "")
      || !["", "PASS", "RESCUED", "FAIL", "NOT_YET_ELIGIBLE"].includes(row.t5_status || "")) {
      return reconcile("Verify the recorded active state, proposal count and reconciliation evidence. Missing or invalid observations are not zero use or a successful customer outcome.");
    }
    if (["RESCUED", "FAIL"].includes(row.t5_status)) {
      return action("REPAIR_CUSTOMER_WORKFLOW", "FOUNDER_AND_ENGINEERING_OWNER",
        "Check current release and data eligibility, then investigate the failed or assisted task. Capture the obstacle and all customer/operator effort, repair the specific problem and verify an unassisted attempt. Do not present rescued use as independent success.");
    }
    if (row.proposal_count === "0") {
      return action("REVIEW_FIRST_DECISION", "FOUNDER_CUSTOMER_SUCCESS_OWNER",
        "Verify current release, assurance and activation evidence before customer-data work. Help the eligible finance owner bring one upcoming obligation and make their own decision; record actual effort and pre-spend timing. No automatic financial decision is allowed.");
    }
    if (row.t5_status !== "PASS") {
      return action("REVIEW_RECONCILIATION", "FOUNDER_CUSTOMER_SUCCESS_OWNER",
        "Confirm current eligibility and wait for the buyer's actual later evidence, then compare it with the frozen authorization and test retrieval on return. Missing evidence is not failure or a reason to invent a bill, outcome or reminder date.");
    }
    return action("REVIEW_VALUE_AND_REPURCHASE", "FOUNDER_CUSTOMER_SUCCESS_OWNER",
      "Verify the recorded reconciliation and ask whether the workflow improved the buyer's decision versus the prior process. Record return use and actual support effort. Review the agreed pilot end before offering a separately purchased month; no automatic renewal or referral outreach.");
  }
  if (present(row.invoice_sent_at)) {
    return action("RECONCILE_PAYMENT", "FOUNDER_PAYMENT_OWNER",
      "Reconcile the issued invoice with native payment, cancellation or refund evidence. An invoice request, sent invoice or browser return is not cleared funds. Respect existing permissions; do not automatically chase payment.");
  }
  if (present(row.invoice_commitment_at)) {
    return action("PREPARE_VERIFIED_INVOICE", "FOUNDER_PAYMENT_AND_LEGAL_OWNER",
      "Verify seller identity, the fixed offer, currency/tax, collection and refund handling, activation feasibility and accepted capacity before issuing the requested invoice. No new provider, charge or promise is authorized by this desk.");
  }
  if (present(row.offer_at)) {
    return action("REVIEW_OFFER_RESPONSE", "FOUNDER",
      "Review the actual buyer answer to the unchanged offer. Separate price, urgency, trust, alternatives and activation concerns; silence is unknown. Do not discount, schedule a reminder or mark an invoice commitment without evidence.");
  }
  if (present(row.conversation_at)) {
    if (row.repeated_job_status === "NO" || row.job_selected === "NONE"
      || row.enforcement_requirement === "NEEDS_ENFORCEMENT") {
      return action("REVIEW_JOB_FIT", "FOUNDER",
        "Review the concrete job and disqualifying evidence. Do not sell financial enforcement or add features to rescue an unsupported thesis. Preserve the buyer's words and test-cell decision rule.");
    }
    if (row.repeated_job_status === "YES" && present(row.next_event_committed_at)
      && row.buying_role === "BUYER" && row.enforcement_requirement === "ADVISORY_ACCEPTED"
      && present(row.spend_threshold_confirmed_at)) {
      return action("REVIEW_FIXED_OFFER", "FOUNDER",
        "Confirm current ICP evidence, consent, buyer authority and a qualifying committed event against the native exchange. Verify credible delivery before presenting the unchanged offer; a generated action is not an offer delivered.");
    }
  }
  if (progressFields.some((field) => present(row[field]))) {
    return action("QUALIFY_RELEVANT_JOB", "FOUNDER",
      "Reply by text only within the person's permission. Establish the last concrete event, recurrence, current alternative, buying role, exposure criterion and next event. A call is optional. Use synthetic examples only; do not request real financial documents.");
  }
  return null;
}

function isRecordedTimestamp(value) {
  return present(value)
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function formatCustomerGuide(actions) {
  return [
    "VOGNARY CUSTOMER OPERATIONS - INTERNAL HUMAN REVIEW ONLY",
    "Derived from recorded CRM fields, not independently verified receipts, release clearance or customer outcomes.",
    "Owner roles are required handoffs, not evidence that someone has accepted the duty.",
    "No automatic outreach, financial action, activation or renewal. Respect opt-outs, current permission and lane ownership.",
    "Real-data intake and unrestricted launch remain blocked until the applicable release and assurance gates are independently cleared.",
    "Use only synthetic examples before clearance. One-time pilot receipts are not ARR.",
    `Unchanged offer: ${pilotOfferText}`,
    "",
    ...(actions.length ? actions.flatMap((entry) => [
      `${entry.id} | ${entry.cell} | ${entry.action} | ${entry.ownerRole}`,
      entry.instruction,
      "",
    ]) : ["No customer-stage actions are supported by the recorded CRM. This is not proof of complete inbox coverage or no demand.", ""]),
    "For each actual handoff record the native evidence reference, owner acknowledgement, agreed next event, actual effort and costs. Unknown stays unmeasured.",
    "At each human-triggered review: observed problem -> one hypothesis -> one change -> the same customer task -> outcome. Do not rewrite failed attempts as success.",
    "",
  ].join("\n");
}

export function formatMarketOperatorDeskSummary(summary) {
  const variants = messageVariants
    .map(({ key }) => `${key}=${summary.variants[key]}`)
    .join(" ");
  return [
    `market desk: ${summary.selectedRows} selected rows`,
    `first-touch drafts: ${summary.firstTouchDrafts} (${summary.firstTouchSendable} with a recorded channel)`,
    `pending day-3 follow-ups: ${summary.pendingFollowUps} (${summary.followUpsWithRecordedChannel} with a recorded channel)`,
    `language variants: ${variants}`,
    `customer actions: ${summary.customerActions} requiring human review`,
    ...Object.entries(summary.customerActionCounts).map(([action, count]) => `  ${action}: ${count}`),
    "A recorded contact channel is not sending permission. Verify current invitation, ownership, duplicate history and opt-outs separately.",
    "No contact was sent. Drafts, calls, replies, offers, invoices, and payments remain evidence-only transitions.",
  ].join("\n");
}

export function mergeMarketSendLog(existingCsv, generatedEntries) {
  const existingRows = existingCsv.trim() ? parseCsvRows(existingCsv) : [];
  const existingHeader = existingRows.shift() ?? [];
  const previousByKey = new Map(existingRows
    .filter((cells) => cells.some((cell) => cell !== ""))
    .map((cells) => {
      const row = Object.fromEntries(existingHeader.map((field, index) => [field, cells[index] ?? ""]));
      const touchType = row.touch_type || "FIRST_TOUCH";
      return [`${row.crm_id}:${touchType}`, { ...row, touch_type: touchType }];
    }));
  const mergedRows = [];
  const generatedKeys = new Set();

  for (const entry of generatedEntries) {
    const key = `${entry.id}:${entry.touchType}`;
    generatedKeys.add(key);
    const previous = previousByKey.get(key) ?? {};
    const channel = present(previous.sent_at)
      ? previous.channel
      : entry.channel || previous.channel || "unrecorded";
    mergedRows.push({
      crm_id: entry.id,
      cell: entry.cell,
      channel,
      touch_type: entry.touchType,
      message_variant: entry.messageVariant || previous.message_variant || "",
      not_before: entry.notBefore || previous.not_before || "",
      sent_at: previous.sent_at || "",
      replied_at: previous.replied_at || "",
      reply_verbatim: previous.reply_verbatim || "",
      outcome: previous.outcome || "",
    });
  }

  for (const [key, previous] of previousByKey) {
    if (!generatedKeys.has(key)) mergedRows.push(previous);
  }

  return `${[
    sendLogHeaders,
    ...mergedRows.map((row) => sendLogHeaders.map((field) => row[field] ?? "")),
  ].map(formatCsvRow).join("\n")}\n`;
}

function buildFirstTouch(row) {
  const variant = variantForId(row.id);
  const channel = normalizeChannel(row.contact_channel);
  const eventPrompt = eventPrompts[row.test_cell];
  const content = `Subject: One real AI/cloud decision?\n\nHi {FirstName},\n\nI'm interviewing finance and technology-cost owners about the last real ${eventPrompt}. Could you reply by text with what triggered it, who could cap or decline it, and how you kept the original decision? A call is optional, up to 20 minutes if you prefer.\n\nI'm testing "${variant.label}" for a record of the named human decision, original cap, expiry and later evidence. It is not a card or payment rail and never moves money. Do not submit real financial documents; use a non-sensitive description or a fictional example only.\n\nIf the job is relevant and delivery conditions can be met, the unchanged pilot is ${pilotOfferText}\n\nWhich upcoming or recent event would make this useful?\n\nVarun\n\n---\nINTERNAL (do not send)\nFounder review and permission, ownership, duplicate and opt-out checks are required before any transmission. A recorded channel is not permission.\n  crm_id   ${row.id}\n  cell     ${row.test_cell}\n  company  ${row.company_name}\n  role     ${row.finance_owner_role || "unknown"}\n  channel  ${channel || "unrecorded - decide before sending"}\n  variant  ${variant.key}\n  profile  ${row.finance_owner_public_url || "none on file"}\n`;
  return {
    id: row.id,
    cell: row.test_cell,
    channel,
    messageVariant: variant.key,
    sendable: contactChannels.has(channel),
    content,
  };
}

function buildFollowUp(row) {
  const channel = normalizeChannel(row.contact_channel);
  const variant = variantForId(row.id);
  const notBefore = addUtcDays(row.contacted_at, 3);
  const content = `Subject: Re: One real AI/cloud decision?\n\nHi {FirstName},\n\nFollowing up once on the last AI, cloud, or software commitment that needed a human cap, or only became visible after the bill. You can reply by text; a call is optional. Do not submit real financial documents; a non-sensitive description is enough.\n\nIf this is not a repeated job for you, I will close the thread. If it is, which upcoming or recent event should we use?\n\nVarun\n\n---\nINTERNAL (do not send)\nFounder review and permission, ownership, duplicate and opt-out checks are required. not_before is a draft date, not authorization or an automatic schedule.\n  crm_id      ${row.id}\n  cell        ${row.test_cell}\n  channel     ${channel || "unrecorded - do not send"}\n  not_before  ${notBefore}\n  variant     ${variant.key}\n`;
  return {
    id: row.id,
    cell: row.test_cell,
    channel,
    messageVariant: variant.key,
    notBefore,
    sendable: contactChannels.has(channel),
    content,
  };
}

function formatInterviewGuide() {
  return [
    "VOGNARY BUYER-JOB INTERVIEW - TEXT FIRST",
    "",
    "Do not explain Vognary before question 7. A call is optional. Follow the person's actual answer rather than sending a questionnaire.",
    "Do not submit real financial documents. Use a non-sensitive description or a fictional example; release and independent assurance gates still apply.",
    "",
    "1. Reconstruct the last two AI, cloud or software cost decisions. What happened, when, and how often?",
    "2. What triggered each event, and where did the work wait?",
    "3. Who could cap or decline it, what did they know, and which existing tool kept that decision?",
    "4. Could the buyer retrieve the original cap and compare later evidence without rebuilding the story?",
    "5. Which dated event will they actually bring next? Was it initiated by a human, an observed variance or an agent/automation?",
    "6. Is a record useful without payment enforcement? Confirm buying authority and the existing exposure criterion privately; record ADVISORY_ACCEPTED or NEEDS_ENFORCEMENT.",
    "7. Explain the selected descriptor once. Compare the same fictional task with the existing process. Record help, effort and objections; a demo is not a delivered customer outcome.",
    "",
    "For a credible consenting buyer, verify activation feasibility and accepted capacity before presenting the unchanged offer:",
    pilotOfferText,
    "",
    "CLASSIFY ONLY FROM A COMMITTED EVENT",
    "AI_SPEND_CHANGE_CONTROL       Human-initiated upcoming AI/cloud obligation needing owner, cap, expiry, and outcome proof.",
    "RECOVERY_FIRST_CONTROL        Observed bill or variance becomes the evidence base for governing the next cycle.",
    "AGENT_SPEND_AUTHORIZATION     Agent or automation initiated the proposed spend/action; a named human owns cap and outcome.",
    "NONE                          Completed conversation produced no qualifying candidate event.",
    "UNMEASURED                    Evidence was insufficient to classify.",
    "",
    "UPDATE THE EXISTING PRIVATE CRM FROM ACTUAL EVIDENCE",
    "conversation_at, repeated_job_status, job_selected, idea_candidate_observed, enforcement_requirement, buying_role, spend_threshold_confirmed_at, next_event_committed_at, founder_minutes, offer_at, invoice_commitment_at, invoice_sent_at, payment_received_at, loss_reason.",
    "A concrete idea_candidate_observed requires both conversation_at and next_event_committed_at. Praise and hypothetical interest remain UNMEASURED.",
    "Use the customer-actions guide for invoice, activation, reconciliation and separately purchased repeat-use handoffs. No automatic message, payment or enrollment follows.",
    "",
  ].join("\n");
}

function variantForId(id) {
  const match = String(id).match(/(\d+)$/);
  const seed = match ? Number(match[1]) - 1 : [...String(id)].reduce((total, char) => total + char.charCodeAt(0), 0);
  return messageVariants[((seed % messageVariants.length) + messageVariants.length) % messageVariants.length];
}

function addUtcDays(value, days) {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) throw new Error(`Cannot schedule follow-up from invalid contacted_at for a selected CRM row.`);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizeChannel(value) {
  return contactChannels.has(value) ? value : "";
}

function present(value) {
  return typeof value === "string" && value.trim() !== "";
}

function formatCsvRow(cells) {
  return cells.map((value) => {
    const normalized = String(value ?? "");
    return /[",\n\r]/.test(normalized) ? `"${normalized.replaceAll('"', '""')}"` : normalized;
  }).join(",");
}