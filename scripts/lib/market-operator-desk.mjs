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
  const firstTouches = selected
    .filter((row) => !present(row.contacted_at))
    .map((row) => buildFirstTouch(row));
  const followUps = selected
    .filter((row) => present(row.contacted_at) && !present(row.replied_at))
    .map((row) => buildFollowUp(row));
  const logEntries = [
    ...firstTouches.map((entry) => ({ ...entry, touchType: "FIRST_TOUCH", notBefore: "" })),
    ...followUps.map((entry) => ({ ...entry, touchType: "DAY_3_FOLLOW_UP" })),
  ];

  return {
    firstTouches,
    followUps,
    logEntries,
    interviewGuide: formatInterviewGuide(),
    summary: {
      selectedRows: selected.length,
      firstTouchDrafts: firstTouches.length,
      firstTouchSendable: firstTouches.filter((entry) => entry.sendable).length,
      pendingFollowUps: followUps.length,
      followUpsWithRecordedChannel: followUps.filter((entry) => entry.sendable).length,
      variants: Object.fromEntries(messageVariants.map(({ key }) => [
        key,
        firstTouches.filter((entry) => entry.messageVariant === key).length,
      ])),
    },
  };
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
  const content = `Subject: One real AI/cloud decision?\n\nHi {FirstName},\n\nI'm interviewing finance and technology-cost owners about the last real ${eventPrompt}. Could we reconstruct one event for 20 minutes: what triggered it, who could cap or decline it, where the decision lived, and what later evidence showed?\n\nI'm testing “${variant.label}” as plain language for a neutral record that preserves the evidence, named human decision, frozen cap, expiry, and later outcome. It is not a card or payment rail and never moves money.\n\nNo financial documents are needed; a verbal reconstruction or synthetic example is enough. Real customer financial data remains blocked until the independent security assessment closes.\n\nIf the job is real, the current pilot is fixed at INR 14,999 one-time for one month: one policy setup, up to 10 proposals, four weekly 30-minute reconciliation reviews, and up to two additional founder-support hours.\n\nWould 20 minutes be useful? If yes, which upcoming or recent event should we use?\n\n— Varun\n\n---\nINTERNAL (do not send)\n  crm_id   ${row.id}\n  cell     ${row.test_cell}\n  company  ${row.company_name}\n  role     ${row.finance_owner_role || "unknown"}\n  channel  ${channel || "unrecorded — decide before sending"}\n  variant  ${variant.key}\n  profile  ${row.finance_owner_public_url || "none on file"}\n`;
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
  const content = `Subject: Re: One real AI/cloud decision?\n\nHi {FirstName},\n\nFollowing up once on the last AI, cloud, or software commitment that needed a human cap, or only became visible after the bill. A 20-minute verbal reconstruction is enough; no documents or customer financial data are needed.\n\nIf this is not a repeated job for you, I will close the thread. If it is, which upcoming or recent event should we use?\n\n— Varun\n\n---\nINTERNAL (do not send)\n  crm_id      ${row.id}\n  cell        ${row.test_cell}\n  channel     ${channel || "unrecorded — do not send"}\n  not_before  ${notBefore}\n  variant     ${variant.key}\n`;
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
  return `VOGNARY BUYER-JOB TOURNAMENT — 20 MINUTES\n\nDo not explain Vognary before question 7. Use verbal reconstruction or screen share only; do not collect customer financial data in Vognary before assurance clears.\n\n0–4  Reconstruct the last two AI, cloud, or software cost decisions. What happened and when?\n4–7  What detected or triggered each event, and where did the work wait?\n7–10 Who could cap or decline it, what evidence did they see, and where was the decision recorded?\n10–13 What later bill, usage record, or provider result showed what actually happened?\n13–16 Which dated event will the buyer bring next? Was it initiated by a human, an observed bill/variance, or an AI agent/automation?\n16–18 Is a neutral record useful without blocking a card or API? Record ADVISORY_ACCEPTED or NEEDS_ENFORCEMENT.\n18–20 Explain the selected descriptor once. For a credible event, make the fixed INR 14,999 offer and keep offer, invoice commitment, invoice, and cleared payment separate.\n\nCLASSIFY ONLY FROM A COMMITTED EVENT\nAI_SPEND_CHANGE_CONTROL       Human-initiated upcoming AI/cloud obligation needing owner, cap, expiry, and outcome proof.\nRECOVERY_FIRST_CONTROL        Observed bill or variance becomes the evidence base for governing the next cycle.\nAGENT_SPEND_AUTHORIZATION     Agent or automation initiated the proposed spend/action; a named human owns cap and outcome.\nNONE                          Completed conversation produced no qualifying candidate event.\nUNMEASURED                    Evidence was insufficient to classify.\n\nUPDATE THE PRIVATE CRM THE SAME DAY\nconversation_at, repeated_job_status, job_selected, idea_candidate_observed, enforcement_requirement, next_event_committed_at, founder_minutes, offer_at, invoice_commitment_at, invoice_sent_at, payment_received_at, loss_reason.\n\nA concrete idea_candidate_observed requires both conversation_at and next_event_committed_at. Praise and hypothetical interest remain UNMEASURED.\n`;
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