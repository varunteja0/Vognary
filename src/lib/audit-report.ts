// Deterministic audit report — the copy-ready summary a founder hands a prospect
// after a free Phase-A audit (paste receipts → send this back). It invents
// NOTHING: every figure is composed from the deterministic engines
// (buildAssistantBrief, buildMandateKillList) and the audit summary, so it obeys
// the same cite-or-shut-up law as the UI. India-first: ₹ is primary and foreign
// spend is reported separately rather than folded in with an invented FX rate.

import { buildAssistantBrief, type BriefAnomaly, type BriefRenewal, type BriefSaving } from "./assistant-brief";
import { buildMandateKillList, type MandateKill } from "./mandate-killlist";
import { formatMoney, formatShortDate } from "./format";
import { primaryCurrency, type AuditResult, type RecommendationType } from "./recurring-audit";

export type AuditReportAction = {
  rank: number;
  kind: "save" | "investigate";
  merchant: string;
  action: RecommendationType;
  /** Observed, evidence-backed monthly charge; 0 only when genuinely unknown. */
  monthlyCost: number;
  annualCost: number;
  currency: string;
  detail: string;
  confidenceScore: number;
};

export type AuditReport = {
  generatedAt: string;
  currency: string;
  monthlyBurn: number;
  annualBurn: number;
  commitmentCount: number;
  averageConfidence: number;
  foreignMonthlyTotals: Record<string, number>;
  renewals: { dueNext7Days: number; dueNext30Days: number; next: BriefRenewal[] };
  topActions: AuditReportAction[];
  mandateKills: MandateKill[];
  potentialMonthlySavings: number;
  potentialAnnualSavings: number;
  sourcesUsed: string[];
  coverageNote: string;
  /** True when built from the illustrative sample rather than real evidence. */
  sample: boolean;
};

export type AuditReportOptions = {
  today?: Date;
  actions?: Record<string, RecommendationType>;
  sample?: boolean;
  maxActions?: number;
  maxRenewals?: number;
};

const defaults = { maxActions: 3, maxRenewals: 5 };

export function buildAuditReport(audit: AuditResult, options: AuditReportOptions = {}): AuditReport {
  const maxActions = options.maxActions ?? defaults.maxActions;
  const brief = buildAssistantBrief({
    recurringItems: audit.recurringItems,
    today: options.today,
    actions: options.actions,
    maxRenewals: options.maxRenewals ?? defaults.maxRenewals,
  });
  const mandateKills = buildMandateKillList(audit.recurringItems);

  return {
    generatedAt: new Date().toISOString(),
    currency: primaryCurrency,
    monthlyBurn: audit.summary.monthlyRecurringSpend,
    annualBurn: audit.summary.annualRecurringSpend,
    commitmentCount: audit.recurringItems.length,
    averageConfidence: audit.summary.averageConfidence,
    foreignMonthlyTotals: audit.summary.foreignMonthlyTotals,
    renewals: {
      dueNext7Days: brief.renewals.dueNext7Days,
      dueNext30Days: brief.renewals.dueNext30Days,
      next: brief.renewals.next,
    },
    topActions: rankActions(brief.savings, brief.anomalies, maxActions),
    mandateKills,
    potentialMonthlySavings: brief.monthlySavings,
    potentialAnnualSavings: brief.annualSavings,
    sourcesUsed: collectSources(audit),
    coverageNote: buildCoverageNote(audit.recurringItems.length, collectSources(audit)),
    sample: options.sample ?? false,
  };
}

// Concrete money moves rank first (cancel/downgrade, biggest annual ₹ freed),
// then anomalies worth investigating. Foreign-currency savings rank after the ₹
// ones because their annual impact cannot be compared on the same axis.
function rankActions(savings: BriefSaving[], anomalies: BriefAnomaly[], max: number): AuditReportAction[] {
  const saveActions = savings.map((saving): AuditReportAction => ({
    rank: 0,
    kind: "save",
    merchant: saving.merchant,
    action: saving.action,
    monthlyCost: saving.monthlyCost,
    annualCost: saving.annualCost,
    currency: saving.currency,
    detail: `frees ${formatMoney(saving.monthlyCost, saving.currency)}/mo (${formatMoney(saving.annualCost, saving.currency)}/yr) — ${saving.reason}`,
    confidenceScore: saving.confidenceScore,
  }));
  saveActions.sort((left, right) => {
    const leftPrimary = left.currency === primaryCurrency ? 1 : 0;
    const rightPrimary = right.currency === primaryCurrency ? 1 : 0;
    if (leftPrimary !== rightPrimary) return rightPrimary - leftPrimary;
    return right.annualCost - left.annualCost || left.merchant.localeCompare(right.merchant);
  });

  const investigateActions = anomalies.map((anomaly): AuditReportAction => ({
    rank: 0,
    kind: "investigate",
    merchant: anomaly.merchant,
    action: "investigate",
    monthlyCost: anomaly.latestAmount ?? 0,
    annualCost: 0,
    currency: anomaly.currency,
    detail: anomaly.detail,
    confidenceScore: anomaly.confidenceScore,
  }));
  investigateActions.sort((left, right) => (right.monthlyCost - left.monthlyCost) || left.merchant.localeCompare(right.merchant));

  return [...saveActions, ...investigateActions].slice(0, max).map((action, index) => ({ ...action, rank: index + 1 }));
}

function collectSources(audit: AuditResult): string[] {
  const seen = new Set<string>();
  for (const item of audit.recurringItems) {
    for (const name of item.sourceNames) if (name) seen.add(name);
    for (const link of item.evidence) if (link.source) seen.add(link.source);
  }
  return [...seen].sort((left, right) => left.localeCompare(right));
}

function buildCoverageNote(commitmentCount: number, sources: string[]): string {
  const sourceList = sources.length ? sources.join(", ") : "the evidence provided";
  return `This audit counts only the ${commitmentCount} recurring commitment${commitmentCount === 1 ? "" : "s"} found in ${sourceList}. Anything not in that evidence — other cards, UPI apps, bank accounts, or app-store subscriptions — is not included, so it is a floor, not a ceiling.`;
}

// A plain-text report the founder can paste into WhatsApp or email. No markdown
// tables (they render badly in chat); just clean lines with the ₹ up front.
export function renderAuditReportText(report: AuditReport): string {
  const lines: string[] = [];
  const date = formatShortDate(report.generatedAt.slice(0, 10));

  lines.push(`Vognary recurring-money audit — ${date}`);
  if (report.sample) lines.push("SAMPLE — illustrative example subscriptions, not real data.");
  lines.push("");
  lines.push(`Monthly burn: ${formatMoney(report.monthlyBurn, report.currency)} (${formatMoney(report.annualBurn, report.currency)}/year) across ${report.commitmentCount} recurring commitment${report.commitmentCount === 1 ? "" : "s"}.`);
  for (const [currency, total] of Object.entries(report.foreignMonthlyTotals)) {
    lines.push(`Also ${formatMoney(total, currency)}/month in ${currency}, kept separate (no invented exchange rate).`);
  }
  lines.push(`Average evidence confidence: ${report.averageConfidence}%.`);
  lines.push("");

  lines.push("What renews next:");
  if (report.renewals.next.length) {
    for (const renewal of report.renewals.next) {
      const away = renewal.daysAway <= 0 ? "today" : `in ${renewal.daysAway}d`;
      lines.push(`- ${renewal.merchant} · ${formatMoney(renewal.amount, renewal.currency)} · ${formatShortDate(renewal.date)} (${away})`);
    }
    lines.push(`(${formatMoney(report.renewals.dueNext7Days, report.currency)} due in 7 days · ${formatMoney(report.renewals.dueNext30Days, report.currency)} due in 30 days.)`);
  } else {
    lines.push("- No proven renewal is projected in the next 30 days.");
  }
  lines.push("");

  lines.push("Do these first:");
  if (report.topActions.length) {
    for (const action of report.topActions) {
      const verb = action.kind === "save" ? action.action.toUpperCase() : "INVESTIGATE";
      lines.push(`${action.rank}. ${verb} ${action.merchant} — ${action.detail}`);
    }
    if (report.potentialMonthlySavings > 0) {
      lines.push(`Acting on the cancel/downgrade items frees ${formatMoney(report.potentialMonthlySavings, report.currency)}/mo (${formatMoney(report.potentialAnnualSavings, report.currency)}/yr).`);
    }
  } else {
    lines.push("- Everything looks intentional — no cancel or downgrade opportunity found in this evidence.");
  }
  lines.push("");

  lines.push("Recurring mandates to stop at the source (UPI AutoPay / NACH / e-mandate):");
  if (report.mandateKills.length) {
    for (const kill of report.mandateKills) {
      const psp = kill.pspHint ? ` · ${kill.pspHint}` : "";
      lines.push(`- ${kill.merchant} · ${kill.railLabel}${psp} — cancelling at ${kill.merchant} alone will not stop this debit; revoke the mandate too.`);
    }
  } else {
    lines.push("- No auto-debit mandate (UPI AutoPay / NACH / e-mandate) was found in this evidence.");
  }
  lines.push("");

  lines.push(`Coverage: ${report.coverageNote}`);
  lines.push("");
  lines.push("Every figure above is backed by the evidence you provided. Vognary never invents amounts, merchants, or renewal dates — anything without proof is left out on purpose.");

  return lines.join("\n");
}

// A chat-length version of the same facts, for pasting into WhatsApp/SMS where
// the full report is too long. It is a strict projection of `report` — no new
// numbers — and keeps the honesty line so brevity never becomes overclaiming.
export function renderAuditReportShareText(report: AuditReport): string {
  const lines: string[] = [];
  const foreign = Object.entries(report.foreignMonthlyTotals)
    .map(([currency, total]) => `${formatMoney(total, currency)}/mo in ${currency}`)
    .join(", ");

  lines.push(`Vognary audit: ${formatMoney(report.monthlyBurn, report.currency)}/mo (${formatMoney(report.annualBurn, report.currency)}/yr) across ${report.commitmentCount} recurring commitment${report.commitmentCount === 1 ? "" : "s"}.${foreign ? ` Plus ${foreign}, kept separate.` : ""}`);

  const nextRenewal = report.renewals.next[0];
  if (nextRenewal) {
    const away = nextRenewal.daysAway <= 0 ? "today" : `in ${nextRenewal.daysAway}d`;
    lines.push(`Next debit: ${nextRenewal.merchant} ${formatMoney(nextRenewal.amount, nextRenewal.currency)} ${away} (${formatShortDate(nextRenewal.date)}).`);
  }

  const topMove = report.topActions[0];
  if (topMove && topMove.kind === "save") {
    lines.push(`Top move: ${topMove.action} ${topMove.merchant} → frees ${formatMoney(topMove.monthlyCost, topMove.currency)}/mo.`);
  } else if (topMove) {
    lines.push(`Watch: ${topMove.merchant} — ${topMove.detail}.`);
  } else {
    lines.push("Nothing to cut — every commitment looks intentional in this evidence.");
  }

  if (report.mandateKills.length) {
    lines.push(`${report.mandateKills.length} auto-debit mandate${report.mandateKills.length === 1 ? "" : "s"} (UPI AutoPay/NACH/e-mandate) to stop at the source, not just the merchant.`);
  }

  lines.push("Every figure is evidence-backed — nothing invented. Full report + proof on request.");

  return lines.join("\n");
}
