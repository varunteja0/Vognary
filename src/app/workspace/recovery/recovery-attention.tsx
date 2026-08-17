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
  REVIEW_SUBSCRIPTION: "Open this subscription",
  CONFIRM_SAME_SUBSCRIPTION: "Tell us if these are the same",
  RECONNECT_SOURCE: "Reconnect the source",
  CHECK_CANCELLATION: "Check the cancellation",
  DECIDE_BEFORE_RENEWAL: "Decide before it renews",
};

const sourceHealthCopy: Record<SourceHealthDto["state"], string> = {
  CURRENT: "Watching now",
  PARTIAL: "Watching, but not for long enough to be sure",
  STALE: "Nothing has arrived here in a while",
  BROKEN: "Stopped working",
  BASELINE_ONLY: "A one-off import; it will not pick up anything new",
  NO_EVIDENCE: "Nothing has arrived yet",
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
}: {
  onOpenCommitment: (commitmentId: string) => void;
  onOpenSources: () => void;
}) {
  const [payload, setPayload] = useState<AttentionPayload | null>(null);
  const [status, setStatus] = useState<"LOADING" | "READY" | "FAILED">("LOADING");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

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
    try {
      const response = await fetch("/api/workspaces/current/recovery-attention", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ACKNOWLEDGE", id }),
      });
      if (!response.ok) throw new Error("acknowledge-failed");
      const body = await response.json() as { data?: AttentionPayload };
      if (body.data) setPayload(body.data);
    } catch {
      setStatus("FAILED");
    } finally {
      setPendingId(null);
    }
  }, []);

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
  const brokenSources = data.sources.filter((source) => source.state === "BROKEN");

  return (
    <div className="grid gap-5">
      <section aria-labelledby="attention-list" className="panel p-4 sm:p-5">
        <h3 id="attention-list" className="font-display text-xl font-semibold text-(--ink)">What needs you</h3>
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
              title="Nothing needs you right now"
              detail="We keep watching. You will only hear from us when something actually changes."
            />
          )}
        </div>
      </section>

      <section aria-labelledby="attention-sources" className="panel p-4 sm:p-5">
        <h3 id="attention-sources" className="font-display text-xl font-semibold text-(--ink)">Where this comes from</h3>
        {brokenSources.length ? (
          <p className="mt-2 text-sm text-(--muted)">
            Something has stopped working, so recent charges may be missing until you reconnect it.
          </p>
        ) : null}
        {!data.coverage.automaticSourceCount ? (
          <p className="mt-2 text-sm text-(--muted)">
            Nothing automatic is watching yet, so new charges will only appear when you add them.
          </p>
        ) : null}
        <ul className="mt-4 grid gap-2">
          {data.sources.map((source) => (
            <li key={source.id} className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl border border-line p-3">
              <span className="text-sm font-medium text-(--ink)">{source.label}</span>
              <span className="font-data text-xs text-(--muted)">{sourceHealthCopy[source.state]}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3">
          <button type="button" onClick={onOpenSources} className="btn btn-sm btn-ghost">Manage sources</button>
        </div>
      </section>

      <section aria-labelledby="attention-beliefs" className="panel p-4 sm:p-5">
        <h3 id="attention-beliefs" className="font-display text-xl font-semibold text-(--ink)">What we think is true</h3>
        <div className="mt-4 grid gap-3">
          {data.commitments.length ? data.commitments.map((commitment) => (
            <article key={commitment.commitmentId} className="rounded-xl border border-line p-3 sm:p-4">
              <h4 className="font-display text-base font-semibold text-(--ink)">{commitment.merchant}</h4>
              <p className="mt-1 text-sm text-(--ink)">{commitment.belief}</p>
              {commitment.because.length ? (
                <p className="mt-1 text-sm text-(--muted)">{commitment.because[0]}</p>
              ) : null}
              <p className="mt-2 font-data text-xs text-(--muted)">
                {commitment.lastVerifiedOn ? `Last seen ${commitment.lastVerifiedOn}.` : "Not seen yet."}
                {commitment.nextVerificationDueOn ? ` We will know more after ${commitment.nextVerificationDueOn}.` : ""}
              </p>
              {commitment.falsifiability.length ? (
                <p className="mt-2 text-sm text-(--muted)">{commitment.falsifiability[0]}</p>
              ) : null}
              <div className="mt-3">
                <button type="button" onClick={() => onOpenCommitment(commitment.commitmentId)} className="btn btn-sm btn-ghost">
                  Open this subscription
                </button>
              </div>
            </article>
          )) : (
            <StateBlock
              eyebrow="Nothing yet"
              title="No subscriptions to describe yet"
              detail="Once a receipt arrives we will tell you what we believe and what would change our mind."
            />
          )}
        </div>
      </section>
    </div>
  );
}
