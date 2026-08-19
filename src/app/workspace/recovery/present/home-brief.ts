import type {
  AttentionItemDto,
  CommitmentSummaryDto,
  HomeProjectionDto,
  PossibleOverlapGroupDto,
  ReceiptInboxStatusDto,
} from "@/lib/recovery/contracts";

export type FirstResultBrief = {
  commitmentCount: number;
  attentionCount: number;
  items: readonly CommitmentSummaryDto[];
};

const homeAttentionReasons = new Set(["DECISION_REQUIRED", "LOW_CONFIDENCE", "PRICE_INCREASE", "EVIDENCE_CONFLICT"]);

export function homeAttentionItems(home: HomeProjectionDto): readonly AttentionItemDto[] {
  const overlapIds = overlapCommitmentIds(home.possibleOverlaps);
  return home.needsMe.filter((item) => homeAttentionReasons.has(item.reason) && !overlapIds.has(item.commitmentId));
}

export function homeHasAttention(home: HomeProjectionDto): boolean {
  return homeAttentionItems(home).length > 0 || home.possibleOverlaps.length > 0;
}

export function homeAttentionCount(home: HomeProjectionDto): number {
  return homeAttentionItems(home).length + home.possibleOverlaps.length;
}

export function shouldShowRecentChange(home: HomeProjectionDto): boolean {
  return home.changed.state === "COMPARED" && home.changed.items.length > 0;
}

export function shouldShowComingUp(home: HomeProjectionDto): boolean {
  return home.next.length > 0;
}

export function shouldOfferKeepCurrent(
  receiptInboxPubliclyAvailable: boolean,
  receiptInbox: ReceiptInboxStatusDto | null,
): boolean {
  if (!receiptInboxPubliclyAvailable) return false;
  if (receiptInbox?.forwardingVerifiedAt && receiptInbox.setupCompletedAt) return false;
  return true;
}

export function firstResultBrief(
  home: HomeProjectionDto,
  commitments: readonly CommitmentSummaryDto[],
): FirstResultBrief {
  return {
    commitmentCount: home.activeCommitmentCount,
    attentionCount: home.decisionQueue.length,
    items: commitments,
  };
}

export function overlapIdsForWorkspace(home: HomeProjectionDto): ReadonlySet<string> {
  return overlapCommitmentIds(home.possibleOverlaps);
}

function overlapCommitmentIds(groups: readonly PossibleOverlapGroupDto[]): Set<string> {
  const ids = new Set<string>();
  for (const group of groups) {
    for (const id of group.commitmentIds) ids.add(id);
  }
  return ids;
}
