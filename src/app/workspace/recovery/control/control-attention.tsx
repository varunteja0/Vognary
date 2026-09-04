"use client";

import type { ControlAttentionItem } from "@/lib/commitment-control/attention";

const urgencyLabels: Record<ControlAttentionItem["urgency"], string> = {
  NOW: "Needs attention now",
  SOON: "Coming up",
};

const actionLabels: Record<ControlAttentionItem["nextStep"], string> = {
  DECIDE_PROPOSAL: "Decide now",
  LINK_EVIDENCE: "Link evidence",
  RECORD_OUTCOME: "Record outcome",
  REVIEW_EXCEPTION: "Record disposition",
  REVIEW_RECORD: "Review record",
};

export function ControlAttention({
  items,
  canAct,
  online,
  pendingProposalId,
  onDecide,
  onReconcile,
  onRecordOutcome,
  onReviewException,
  onReview,
}: {
  items: readonly ControlAttentionItem[];
  canAct: boolean;
  online: boolean;
  pendingProposalId: string | null;
  onDecide: (proposalId: string, returnFocusId: string) => void;
  onReconcile: (proposalId: string, returnFocusId: string) => void;
  onRecordOutcome: (proposalId: string, returnFocusId: string) => void;
  onReviewException: (proposalId: string, targetKind: NonNullable<ControlAttentionItem["targetKind"]>, targetId: string, returnFocusId: string) => void;
  onReview: (proposalId: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="control-attention-heading" className="control-band control-band-open">
      <div className="control-band-head">
        <h3 id="control-attention-heading" className="control-heading">Needs you</h3>
        <p className="control-band-count">{items.length} {items.length === 1 ? "open item" : "open items"}</p>
      </div>
      <ol className="control-review-list">
        {items.map((attention) => {
          const buttonId = `control-attention-${attention.id.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}`;
          const pending = pendingProposalId === attention.proposalId;
          const requiresAuthority = attention.nextStep !== "REVIEW_RECORD";
          return (
            <li key={attention.id}>
              <div className="min-w-0">
                <p className="truth-label">{urgencyLabels[attention.urgency]} · due {attention.dueOn}</p>
                <p className="control-card-meta">{attention.merchant}</p>
                <h4 className="font-display text-base font-semibold text-(--ink)">{attention.headline}</h4>
                <p className="control-note">{attention.body}</p>
              </div>
              {!requiresAuthority || canAct ? (
                <button
                  id={buttonId}
                  type="button"
                  className={attention.urgency === "NOW" ? "btn btn-sm btn-primary" : "btn btn-sm btn-ghost"}
                  disabled={pending || !online}
                  onClick={() => {
                    if (attention.nextStep === "DECIDE_PROPOSAL") onDecide(attention.proposalId, buttonId);
                    else if (attention.nextStep === "LINK_EVIDENCE") onReconcile(attention.proposalId, buttonId);
                    else if (attention.nextStep === "RECORD_OUTCOME") onRecordOutcome(attention.proposalId, buttonId);
                    else if (attention.nextStep === "REVIEW_EXCEPTION" && attention.targetKind && attention.targetId) {
                      onReviewException(attention.proposalId, attention.targetKind, attention.targetId, buttonId);
                    }
                    else onReview(attention.proposalId);
                  }}
                >
                  {pending ? "Working…" : actionLabels[attention.nextStep]}
                </button>
              ) : (
                <p className="control-card-meta">A workspace owner or admin handles this item.</p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}