"use client";

import { useCallback, useEffect, useState } from "react";

import { StateBlock } from "./recovery-states";

/**
 * The Attention surface: one ordered list of things a person can act on.
 *
 * Everything shown here is written in the customer's words. No state names, no
 * scores, no internal identifiers and no source terminology reach the screen.
 */
type AttentionCardDto = {
  id: string;
  commitmentId: string | null;
  otherCommitmentId: string | null;
  headline: string;
  body: string;
  urgency: "NOW" | "SOON" | "WHENEVER";
  nextStep: "REVIEW_SUBSCRIPTION" | "CONFIRM_SAME_SUBSCRIPTION" | "RECONNECT_SOURCE" | "CHECK_CANCELLATION" | "DECIDE_BEFORE_RENEWAL";
  dueDate: string | null;
};

type SourceHealthDto = {
  id: string;
  label: string;
  state: "CURRENT" | "PARTIAL" | "STALE" | "BROKEN" | "BASELINE_ONLY" | "NO_EVIDENCE";
  automatic: boolean;
  coverageStart: string | null;
  coverageEnd: string | null;
};

type AttentionPayload = {
  attention: readonly AttentionCardDto[];
  coverage: { coverageBroken: boolean; automaticSourceCount: number; limitations: readonly string[] };
  sources: readonly SourceHealthDto[];
  commitments: readonly {
    commitmentId: string;
    merchant: string;
    belief: string;
    because: readonly string[];
    falsifiability: readonly string[];
    lastVerifiedOn: string | null;
    nextVerificationDueOn: string | null;
  }[];
};

const urgencyCopy: Record<AttentionCardDto["urgency"], string> = {
  NOW: "Worth doing today",
  SOON: "Worth a look this week",
  WHENEVER: "No rush",
};

const nextStepCopy: Record<AttentionCardDto["nextStep"], string> = {
  REVIEW_SUBSCRIPTION: "Open this commitment",
  CONFIRM_SAME_SUBSCRIPTION: "Tell us if these are the same",
  RECONNECT_SOURCE: "Open sources",
  CHECK_CANCELLATION: "Check the cancellation",
  DECIDE_BEFORE_RENEWAL: "Decide before it renews",
};

async function fetchAttention(): Promise<AttentionPayload> {
  const response = await fetch("/api/workspaces/current/recovery-attention", { cache: "no-store" });
  if (!response.ok) throw new Error("attention-unavailable");
  const body = await response.json() as { data?: AttentionPayload };
  if (!body.data) throw new Error("attention-unavailable");
  return body.data;
}

export function RecoveryAttention({
  onOpenCommitment,
  onOpenSources,
  onWorkspaceMutated,
}: {
  onOpenCommitment: (commitmentId: string) => void;
  onOpenSources: () => void;
  onWorkspaceMutated?: () => void;
}) {
  const [payload, setPayload] = useState<AttentionPayload | null>(null);
  const [status, setStatus] = useState<"LOADING" | "READY" | "FAILED">("LOADING");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAttention()
      .then((data) => {
        if (cancelled) return;
        setPayload(data);
        setStatus("READY");
      })
      .catch(() => {
        if (!cancelled) setStatus("FAILED");
      });
    return () => { cancelled = true; };
  }, [reloadKey]);

  const retry = useCallback(() => {
    setStatus("LOADING");
    setReloadKey((key) => key + 1);
  }, []);

  const acknowledge = useCallback(async (id: string) => {
    setPendingId(id);
    setActionError(null);
    try {
      const response = await fetch("/api/workspaces/current/recovery-attention", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ACKNOWLEDGE", id }),
      });
      if (!response.ok) throw new Error("acknowledge-failed");
      const body = await response.json() as { data?: AttentionPayload };
      if (body.data) setPayload(body.data);
      onWorkspaceMutated?.();
    } catch {
      setActionError("That change did not save. Nothing was assumed. Try again.");
    } finally {
      setPendingId(null);
    }
  }, [onWorkspaceMutated]);

  const answerDuplicate = useCallback(async (card: AttentionCardDto, sameSubscription: boolean) => {
    if (!card.commitmentId || !card.otherCommitmentId) return;
    setPendingId(card.id);
    setActionError(null);
    try {
      const response = await fetch("/api/workspaces/current/recovery-attention", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ANSWER_DUPLICATE",
          commitmentId: card.commitmentId,
          otherCommitmentId: card.otherCommitmentId,
          sameSubscription,
        }),
      });
      if (!response.ok) throw new Error("answer-duplicate-failed");
      const body = await response.json() as { data?: AttentionPayload };
      if (body.data) setPayload(body.data);
      onWorkspaceMutated?.();
    } catch {
      setActionError("We could not save whether those commitments are the same. Nothing was merged. Try again.");
    } finally {
      setPendingId(null);
    }
  }, [onWorkspaceMutated]);

  if (status === "LOADING" && !payload) {
    return <StateBlock eyebrow="Checking" title="Looking at what changed" detail="We are re-reading your receipts before showing you anything." />;
  }

  if (status === "FAILED" && !payload) {
    return (
      <StateBlock
        eyebrow="Could not load"
        title="We could not check for changes just now"
        detail="Nothing was changed. Try again in a moment."
      >
        <button type="button" onClick={retry} className="btn btn-sm btn-primary">Try again</button>
      </StateBlock>
    );
  }

  const data = payload!;
  if (status === "READY" && data.attention.length === 0 && !data.coverage.coverageBroken) {
    return null;
  }

  return (
    <section aria-labelledby="attention-list" className="panel p-4 sm:p-5">
      <h3 id="attention-list" className="font-display text-xl font-semibold text-(--ink)">What changed</h3>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-(--muted)">
        Only changes backed by stored evidence or a source that was actually watching. Missing evidence is not treated as cancellation.
      </p>
      {actionError ? <p role="alert" className="mt-2 text-sm text-ember">{actionError}</p> : null}
      <div className="mt-4 grid gap-3">
        {data.attention.length ? data.attention.map((card) => (
          <article key={card.id} className="rounded-xl border border-line p-3 sm:p-4">
            <p className="eyebrow eyebrow-xs text-(--muted)">{urgencyCopy[card.urgency]}</p>
            <h4 className="mt-1 font-display text-base font-semibold text-(--ink)">{card.headline}</h4>
            <p className="mt-1 text-sm text-(--muted)">{card.body}</p>
            {card.dueDate ? <p className="mt-1 font-data text-xs text-(--muted)">Expected {card.dueDate}</p> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              {card.nextStep === "RECONNECT_SOURCE" ? (
                <button type="button" onClick={onOpenSources} className="btn btn-sm btn-primary">
                  {nextStepCopy[card.nextStep]}
                </button>
              ) : card.nextStep === "CONFIRM_SAME_SUBSCRIPTION" && card.commitmentId && card.otherCommitmentId ? (
                <>
                  <button
                    type="button"
                    onClick={() => void answerDuplicate(card, true)}
                    disabled={pendingId === card.id}
                    className="btn btn-sm btn-primary"
                  >
                    {pendingId === card.id ? "Saving…" : "Yes, they are the same"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void answerDuplicate(card, false)}
                    disabled={pendingId === card.id}
                    className="btn btn-sm btn-ghost"
                  >
                    No, they are different
                  </button>
                </>
              ) : card.commitmentId ? (
                <button type="button" onClick={() => onOpenCommitment(card.commitmentId!)} className="btn btn-sm btn-primary">
                  {nextStepCopy[card.nextStep]}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void acknowledge(card.id)}
                disabled={pendingId === card.id}
                className="btn btn-sm btn-ghost"
              >
                {pendingId === card.id ? "Saving…" : "I have seen this"}
              </button>
            </div>
          </article>
        )) : (
          <StateBlock
            eyebrow="Nothing new"
            title="Nothing changed that needs you"
            detail="Vognary keeps watching. You will only see a change here when stored evidence or a watching source supports it."
          />
        )}
      </div>
    </section>
  );
}
