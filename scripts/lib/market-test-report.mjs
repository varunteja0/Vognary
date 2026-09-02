const marketTestCells = [
  "DIRECT_FINANCE",
  "FRACTIONAL_FINANCE",
  "FINOPS_AI_OPERATIONS",
];

const requiredHeaders = [
  "id",
  "contact_cohort",
  "test_cell",
  "finance_owner_public_url",
  "operator_scope_count",
  "technology_spend_responsibility",
  "contact_channel",
  "founder_minutes",
  "contacted_at",
  "replied_at",
  "conversation_at",
  "repeated_job_status",
  "job_selected",
  "enforcement_requirement",
  "next_event_committed_at",
  "offer_at",
  "invoice_commitment_at",
  "invoice_sent_at",
  "payment_received_at",
  "t5_status",
];

const closedVocabularies = {
  contact_cohort: ["", "QUALIFIED", "EXPLORATORY"],
  test_cell: ["", ...marketTestCells],
  technology_spend_responsibility: ["", "YES", "NO", "UNMEASURED"],
  contact_channel: ["", "WARM_INTRO", "MANUAL_DIRECT", "REFERRAL", "PARTNER", "OTHER"],
  repeated_job_status: ["", "YES", "NO", "UNMEASURED"],
  job_selected: ["", "PRE_SPEND", "RECOVERY", "DECISION_TO_OUTCOME", "NONE", "UNMEASURED"],
  enforcement_requirement: ["", "ADVISORY_ACCEPTED", "NEEDS_ENFORCEMENT", "UNMEASURED"],
  t5_status: ["", "PASS", "RESCUED", "FAIL", "NOT_YET_ELIGIBLE"],
};

export function parseMarketTestCsv(input) {
  const matrix = parseCsvRows(input);
  const header = matrix.shift()?.map((field, index) => index === 0 ? field.replace(/^\uFEFF/, "") : field) ?? [];
  if (!header.length) throw new Error("Market CRM header is missing.");
  if (new Set(header).size !== header.length) throw new Error("Market CRM header contains duplicate fields.");
  for (const field of requiredHeaders) {
    if (!header.includes(field)) throw new Error(`Market CRM header is missing ${field}.`);
  }

  return matrix
    .filter((cells) => cells.some((cell) => cell !== ""))
    .map((cells, index) => {
      const rowNumber = index + 2;
      if (cells.length > header.length) throw new Error(`Market CRM row ${rowNumber} exceeds the header width.`);
      const row = Object.fromEntries(header.map((field, fieldIndex) => [field, cells[fieldIndex] ?? ""]));
      for (const [field, allowed] of Object.entries(closedVocabularies)) {
        if (!allowed.includes(row[field])) throw new Error(`Market CRM row ${rowNumber} has an invalid ${field}.`);
      }
      if (present(row.founder_minutes) && !isNonNegativeInteger(row.founder_minutes)) {
        throw new Error(`Market CRM row ${rowNumber} has invalid founder_minutes.`);
      }
      return row;
    });
}

export function summarizeMarketTest(rows) {
  const cells = Object.fromEntries(marketTestCells.map((cell) => {
    const selected = rows.filter((row) => row.test_cell === cell);
    const evidenceReadyCandidates = selected.filter((row) => evidenceReadyForCell(row, cell)).length;
    const conversations = countPresent(selected, "conversation_at");
    const repeatedJobs = selected.filter((row) => row.repeated_job_status === "YES").length;
    const committedEvents = countPresent(selected, "next_event_committed_at");
    const payments = countPresent(selected, "payment_received_at");
    const invoiceCommitments = countPresent(selected, "invoice_commitment_at");
    const paymentOrInvoiceCommitments = selected.filter((row) => present(row.payment_received_at) || present(row.invoice_commitment_at)).length;
    return [cell, {
      selectedRows: selected.length,
      evidenceReadyCandidates,
      contacted: countPresent(selected, "contacted_at"),
      replies: countPresent(selected, "replied_at"),
      conversations,
      repeatedJobs,
      selectedPreSpend: selected.filter((row) => row.job_selected === "PRE_SPEND").length,
      selectedRecovery: selected.filter((row) => row.job_selected === "RECOVERY").length,
      selectedDecisionToOutcome: selected.filter((row) => row.job_selected === "DECISION_TO_OUTCOME").length,
      committedEvents,
      advisoryAccepted: selected.filter((row) => row.enforcement_requirement === "ADVISORY_ACCEPTED").length,
      needsEnforcement: selected.filter((row) => row.enforcement_requirement === "NEEDS_ENFORCEMENT").length,
      offers: countPresent(selected, "offer_at"),
      invoiceCommitments,
      invoices: countPresent(selected, "invoice_sent_at"),
      payments,
      t5Passes: selected.filter((row) => row.t5_status === "PASS").length,
      paymentOrInvoiceCommitments,
      directionalGate: conversations >= 5 && repeatedJobs >= 3 && committedEvents >= 2 && paymentOrInvoiceCommitments >= 1
        ? "WIN_CANDIDATE"
        : "INCOMPLETE",
    }];
  }));

  const offers = countPresent(rows, "offer_at");
  const clearedPayments = countPresent(rows, "payment_received_at");
  const conversations = countPresent(rows, "conversation_at");
  const totalFounderMinutes = rows.reduce((total, row) => total + founderMinutes(row), 0);
  const contactedByChannel = {
    WARM_INTRO: 0,
    MANUAL_DIRECT: 0,
    REFERRAL: 0,
    PARTNER: 0,
    OTHER: 0,
    UNMEASURED: 0,
  };
  for (const row of rows.filter((entry) => present(entry.contacted_at))) {
    contactedByChannel[row.contact_channel || "UNMEASURED"] += 1;
  }
  return {
    totalRows: rows.length,
    unassignedRows: rows.filter((row) => !marketTestCells.includes(row.test_cell)).length,
    cells,
    contactedByChannel,
    founderEffort: {
      totalMinutes: totalFounderMinutes,
      minutesPerConversation: conversations ? Number((totalFounderMinutes / conversations).toFixed(1)) : null,
      minutesPerClearedPayment: clearedPayments ? Number((totalFounderMinutes / clearedPayments).toFixed(1)) : null,
    },
    cohortGate: {
      status: marketTestCells.every((cell) => cells[cell].evidenceReadyCandidates >= 5) ? "READY" : "INCOMPLETE",
    },
    companyGate: {
      offers,
      clearedPayments,
      status: offers < 10
        ? "INCOMPLETE"
        : clearedPayments >= 2
          ? "GO"
          : clearedPayments === 1
            ? "REWORK"
            : "FAIL",
    },
  };
}

export function formatMarketTestReport(summary) {
  const lines = [
    `Market wedge test: ${summary.totalRows} rows; ${summary.unassignedRows} unassigned`,
  ];
  for (const cell of marketTestCells) {
    const value = summary.cells[cell];
    lines.push(`${cell} ${value.directionalGate}: ${value.selectedRows} selected · ${value.evidenceReadyCandidates}/5 evidence-ready · ${value.contacted} contacted · ${value.replies} replied · ${value.conversations}/5 conversations · ${value.repeatedJobs}/3 repeated jobs · ${value.committedEvents}/2 committed events · ${value.paymentOrInvoiceCommitments}/1 payment or invoice commitment`);
    lines.push(`  jobs: ${value.selectedPreSpend} pre-spend · ${value.selectedRecovery} Recovery · ${value.selectedDecisionToOutcome} decision-to-outcome · boundary: ${value.advisoryAccepted} advisory accepted · ${value.needsEnforcement} needs enforcement`);
  }
  const channels = summary.contactedByChannel;
  lines.push(`Contacted channels: ${channels.WARM_INTRO} warm intro · ${channels.MANUAL_DIRECT} manual direct · ${channels.REFERRAL} referral · ${channels.PARTNER} partner · ${channels.OTHER} other · ${channels.UNMEASURED} unmeasured`);
  lines.push(`Founder effort: ${summary.founderEffort.totalMinutes} recorded min · ${formatMinutesRate(summary.founderEffort.minutesPerConversation, "conversation")} · ${formatMinutesRate(summary.founderEffort.minutesPerClearedPayment, "cleared payment")}`);
  lines.push(`Cohort gate ${summary.cohortGate.status}`);
  lines.push(`Company gate ${summary.companyGate.status}: ${summary.companyGate.offers}/10 offers · ${summary.companyGate.clearedPayments}/2 cleared payments`);
  lines.push("Invoice commitments, invoices, and pending payment do not count as cleared payment.");
  return lines.join("\n");
}

function countPresent(rows, field) {
  return rows.filter((row) => present(row[field])).length;
}

function present(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isNonNegativeInteger(value) {
  return /^(0|[1-9]\d*)$/.test(value) && Number.isSafeInteger(Number(value));
}

function founderMinutes(row) {
  return present(row.founder_minutes) ? Number(row.founder_minutes) : 0;
}

function formatMinutesRate(value, denominator) {
  return value === null ? `min/${denominator} unmeasured` : `${value} min/${denominator}`;
}

function evidenceReadyForCell(row, cell) {
  if (cell === "DIRECT_FINANCE") return row.contact_cohort === "QUALIFIED";
  if (!present(row.finance_owner_public_url)) return false;
  if (cell === "FRACTIONAL_FINANCE") {
    const scope = Number(row.operator_scope_count);
    return Number.isInteger(scope) && scope >= 5;
  }
  return row.technology_spend_responsibility === "YES";
}

function parseCsvRows(input) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];
    if (char === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error("Market CRM contains an unterminated quoted field.");
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}