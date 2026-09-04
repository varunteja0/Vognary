const introductionRequestTarget = 10;
const publicArtifactTarget = 1;
const publicReplyTarget = 3;
const roundtableTarget = 1;

export function buildDistributionDailyDesk(input) {
  const asOfDate = canonicalUtcDate(input.asOf);
  const cellValues = Object.values(input.market.cells);
  const replies = cellValues.reduce((total, cell) => total + cell.replies, 0);
  const conversations = cellValues.reduce((total, cell) => total + cell.conversations, 0);
  const unhandledReplies = Math.max(0, replies - conversations);
  const dueSendableFollowUps = input.operator.followUps.filter((followUp) => (
    followUp.sendable && followUp.notBefore <= asOfDate
  )).length;
  const sendableFirstTouches = input.operator.firstTouches.filter((touch) => touch.sendable).length;
  const blockedFirstTouches = input.operator.firstTouches.length - sendableFirstTouches;

  return {
    asOf: input.asOf,
    primaryAction: choosePrimaryAction({
      companyGate: input.market.companyGate,
      unhandledReplies,
      dueSendableFollowUps,
      sendableFirstTouches,
      blockedFirstTouches,
    }),
    companyGate: { ...input.market.companyGate },
    unhandledReplies,
    dueSendableFollowUps,
    sendableFirstTouches,
    blockedFirstTouches,
    targets: {
      introductionRequestsRemaining: remaining(
        introductionRequestTarget,
        input.distribution.commercial.introductionsRequested,
      ),
      publicArtifactsRemaining: remaining(
        publicArtifactTarget,
        input.distribution.audience.artifactsPublished,
      ),
      publicRepliesRemaining: remaining(
        publicReplyTarget,
        input.distribution.audience.publicReplies,
      ),
      roundtablesRemaining: remaining(
        roundtableTarget,
        input.distribution.audience.roundtablesScheduled,
      ),
    },
    measurementStatus: input.distribution.measurementStatus,
    effortCoverage: input.distribution.effort.coverage,
    founderMinutes: input.distribution.effort.totalFounderMinutes,
  };
}

export function formatDistributionDailyDesk(desk) {
  return [
    `Distribution daily desk as of ${desk.asOf}`,
    `Primary action: ${primaryActionLabel(desk)}`,
    `Company gate ${desk.companyGate.status}: ${desk.companyGate.offers}/10 offers · ${desk.companyGate.clearedPayments}/2 cleared payments`,
    `Private queues: ${desk.unhandledReplies} unhandled substantive replies · ${desk.dueSendableFollowUps} due permitted follow-ups · ${desk.sendableFirstTouches} sendable first touches · ${desk.blockedFirstTouches} first touches blocked on a permitted route`,
    `Window targets: ${formatRemaining(desk.targets.introductionRequestsRemaining, "introduction request")} · ${formatRemaining(desk.targets.publicArtifactsRemaining, "public artifact")} · ${formatRemaining(desk.targets.publicRepliesRemaining, "public reply")} · ${formatRemaining(desk.targets.roundtablesRemaining, "roundtable schedule")}`,
    `Measurement ${desk.measurementStatus}; founder effort ${desk.effortCoverage}: ${desk.founderMinutes === null ? "unmeasured" : `${desk.founderMinutes} min`}`,
    "A draft, post, delivery, booking, invoice commitment, or settlement reference is not the next funnel state without its authoritative evidence.",
  ].join("\n");
}

function choosePrimaryAction(input) {
  if (input.companyGate.offers >= 10) return "APPLY_COMPANY_GATE";
  if (input.unhandledReplies > 0) return "HANDLE_SUBSTANTIVE_REPLIES";
  if (input.dueSendableFollowUps > 0) return "REVIEW_DUE_FOLLOW_UPS";
  if (input.sendableFirstTouches > 0) return "REVIEW_SENDABLE_FIRST_TOUCHES";
  if (input.blockedFirstTouches > 0) return "SECURE_PERMITTED_ROUTES";
  return "BOOK_BEHAVIORAL_CONVERSATIONS";
}

function primaryActionLabel(desk) {
  if (desk.primaryAction === "APPLY_COMPANY_GATE") {
    return "apply the 10-offer company gate using CRM and provider-confirmed cleared payments";
  }
  if (desk.primaryAction === "HANDLE_SUBSTANTIVE_REPLIES") {
    return `handle ${desk.unhandledReplies} substantive ${desk.unhandledReplies === 1 ? "reply" : "replies"} before new outreach`;
  }
  if (desk.primaryAction === "REVIEW_DUE_FOLLOW_UPS") {
    return `review ${desk.dueSendableFollowUps} due permitted ${desk.dueSendableFollowUps === 1 ? "follow-up" : "follow-ups"}`;
  }
  if (desk.primaryAction === "REVIEW_SENDABLE_FIRST_TOUCHES") {
    return `review ${desk.sendableFirstTouches} first-touch ${desk.sendableFirstTouches === 1 ? "draft" : "drafts"} with recorded permitted routes`;
  }
  if (desk.primaryAction === "SECURE_PERMITTED_ROUTES") {
    return "secure permitted warm, referral, partner, or manual routes before using blocked drafts";
  }
  return "book the next behavior-first buyer conversation";
}

function remaining(target, observed) {
  if (observed === null || observed === undefined) return null;
  return Math.max(0, target - observed);
}

function formatRemaining(value, label) {
  if (value === null) return `${label} target unmeasured`;
  return `${value} ${value === 1 ? label : pluralize(label)} remaining`;
}

function pluralize(value) {
  return /[^aeiou]y$/i.test(value) ? `${value.slice(0, -1)}ies` : `${value}s`;
}

function canonicalUtcDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new Error("Distribution daily desk asOf must be a canonical UTC timestamp.");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error("Distribution daily desk asOf must be a valid UTC timestamp.");
  }
  return value.slice(0, 10);
}