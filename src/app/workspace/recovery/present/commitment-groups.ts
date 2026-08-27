import type { Cadence, CommitmentSummaryDto, HomeProjectionDto } from "@/lib/recovery/contracts";
import { commitmentDecisionState, type DecisionStateTone } from "./decision-state";
import { commitmentNeedsAttention } from "./commitment-status";

export type CommitmentGroup = {
  key: string;
  merchant: string;
  currency: string;
  cadence: Cadence;
  commitments: readonly CommitmentSummaryDto[];
};

const decisionTonePriority: Record<DecisionStateTone, number> = {
  due: 0,
  cancel: 1,
  neutral: 2,
  keep: 3,
};

export function commitmentGroupKey(
  commitment: Pick<CommitmentSummaryDto, "merchant" | "cadence" | "amount">,
): string {
  return `${commitment.merchant.trim().toLowerCase()}::${commitment.amount.currency}::${commitment.cadence}`;
}

export function groupCommitments(commitments: readonly CommitmentSummaryDto[]): CommitmentGroup[] {
  const buckets = new Map<string, CommitmentSummaryDto[]>();
  for (const commitment of commitments) {
    const key = commitmentGroupKey(commitment);
    const list = buckets.get(key) ?? [];
    list.push(commitment);
    buckets.set(key, list);
  }
  return [...buckets.entries()].map(([key, items]) => ({
    key,
    merchant: items[0]!.merchant,
    currency: items[0]!.amount.currency,
    cadence: items[0]!.cadence,
    commitments: orderCommitmentsInGroup(items),
  }));
}

export function representativeCommitment(group: CommitmentGroup): CommitmentSummaryDto {
  return group.commitments[0]!;
}

export function groupDecisionState(
  group: CommitmentGroup,
  home: HomeProjectionDto | null,
): { label: string; tone: DecisionStateTone } {
  const states = group.commitments.map((commitment) => commitmentDecisionState(commitment, home));
  return states.reduce((worst, current) => (
    decisionTonePriority[current.tone] < decisionTonePriority[worst.tone] ? current : worst
  ));
}

export function groupNeedsAttention(
  group: CommitmentGroup,
  overlapIds: ReadonlySet<string>,
): boolean {
  return group.commitments.some((commitment) => commitmentNeedsAttention(commitment, overlapIds.has(commitment.id)));
}

export function findGroupForCommitment(
  groups: readonly CommitmentGroup[],
  commitmentId: string,
): CommitmentGroup | null {
  return groups.find((group) => group.commitments.some((commitment) => commitment.id === commitmentId)) ?? null;
}

function orderCommitmentsInGroup(items: readonly CommitmentSummaryDto[]): CommitmentSummaryDto[] {
  const ordered: CommitmentSummaryDto[] = [];
  for (const item of items) {
    const itemDate = item.nextExpectedDate ?? item.updatedAt;
    let inserted = false;
    for (let index = 0; index < ordered.length; index += 1) {
      const currentDate = ordered[index]!.nextExpectedDate ?? ordered[index]!.updatedAt;
      if (itemDate.localeCompare(currentDate) > 0) {
        ordered.splice(index, 0, item);
        inserted = true;
        break;
      }
    }
    if (!inserted) ordered.push(item);
  }
  return ordered;
}
