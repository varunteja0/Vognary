"use client";

import type { ReactNode } from "react";
import type { ConfidenceDto, MoneyDto } from "@/lib/recovery/contracts";
import { confidenceLabels, confidenceUncertainty, errorCopy } from "./labels";
import type { RecoveryFailure } from "./state";

// Every honest state the Recovery workspace can be in, rendered from server truth
// or from a plainly-labelled device-side fact. Nothing here guesses.

export function StateBlock({
  eyebrow,
  title,
  detail,
  tone = "neutral",
  children,
}: {
  eyebrow: string;
  title: string;
  detail: string;
  tone?: "neutral" | "caution" | "danger";
  children?: ReactNode;
}) {
  const toneClass = tone === "danger" ? "border-ember" : tone === "caution" ? "border-ochre" : "border-line";
  return (
    <div className={`inset border ${toneClass} p-4 sm:p-5`}>
      <p className="eyebrow eyebrow-xs">{eyebrow}</p>
      <p className="mt-2 font-display text-lg font-semibold text-(--ink)">{title}</p>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-(--muted)">{detail}</p>
      {children ? <div className="mt-4 flex flex-wrap gap-2">{children}</div> : null}
    </div>
  );
}

export function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="inset p-5" aria-busy="true">
      <p role="status" className="font-data text-xs text-(--muted)">{label}</p>
      <div className="mt-4 grid gap-2" aria-hidden>
        <div className="h-4 w-2/3 animate-pulse rounded bg-(--card-3)" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-(--card-3)" />
        <div className="h-4 w-3/4 animate-pulse rounded bg-(--card-3)" />
      </div>
    </div>
  );
}

export function FailureBlock({ failure, children }: { failure: RecoveryFailure; children?: ReactNode }) {
  const { error, origin } = failure;
  const copy = errorCopy[error.code];
  return (
    <div className="inset border border-ember p-4 sm:p-5" role="alert">
      <p className="eyebrow eyebrow-xs text-ember">{copy.title}</p>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-(--ink-soft)">{copy.detail}</p>
      {error.code === "STALE_STATE" ? (
        <p className="mt-2 font-data text-xs text-(--muted)">The saved workspace is at version {error.currentVersion}.</p>
      ) : null}
      {error.code === "RATE_LIMITED" ? (
        <p className="mt-2 font-data text-xs text-(--muted)">Retry after {error.retryAfterSeconds} seconds.</p>
      ) : null}
      <details className="mt-2">
        <summary className="cursor-pointer font-data text-xs text-(--muted)">Technical details</summary>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-(--muted)">Reported message: {error.message}</p>
        <p className="mt-2 font-data text-xs text-(--muted)">
          {origin === "SERVER" ? "Raised by the workspace" : "Raised on this device before the workspace answered"} · reference {error.requestId} · {error.retryable ? "safe to retry" : "retrying will not help"}
        </p>
      </details>
      {children ? <div className="mt-4 flex flex-wrap gap-2">{children}</div> : null}
    </div>
  );
}

export function AuthRequiredBlock() {
  return (
    <StateBlock
      eyebrow="Sign in required"
      title="This workspace is not open on this device"
      detail="Your saved commitments stay on the server. Sign in with the same account to open them again."
    >
      <a href="/login?next=/app" className="btn btn-primary">Sign in to continue</a>
    </StateBlock>
  );
}

export function OfflineBlock() {
  return (
    <StateBlock
      eyebrow="Offline"
      title="This device is offline"
      detail="Saved workspace data cannot be read or changed while offline. Nothing shown here was invented locally, and nothing you do now will be sent until the connection returns."
      tone="caution"
    />
  );
}

export function MoneyValue({ amount, className }: { amount: MoneyDto; className?: string }) {
  return (
    <span className={`font-data tnum ${className ?? ""}`} aria-label={`${amount.display} ${amount.currency}`}>
      {amount.display}
    </span>
  );
}

export function ConfidenceBadge({ confidence }: { confidence: ConfidenceDto }) {
  const pillClass = confidence.state === "HIGH" ? "pill pill-ready" : confidence.state === "UNKNOWN" ? "pill pill-planned" : confidence.state === "LOW" ? "pill pill-blocked" : "pill pill-partial";
  return (
    <span className={pillClass}>
      {confidenceLabels[confidence.state]}
    </span>
  );
}

export function ConfidenceDetail({ confidence }: { confidence: ConfidenceDto }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <ConfidenceBadge confidence={confidence} />
        <span className="font-data text-xs text-(--muted)">
          This confidence level is based on the cited evidence available to Vognary.
        </span>
      </div>
      <p className="mt-2 text-sm leading-6 text-(--muted)">{confidenceUncertainty[confidence.state]}</p>
      {confidence.reasons.length ? (
        <ul className="mt-2 grid gap-1">
          {confidence.reasons.map((reason) => (
            <li key={reason} className="text-sm leading-6 text-(--ink-soft)">· {reason}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm leading-6 text-(--muted)">The workspace published no reasons for this confidence.</p>
      )}
    </div>
  );
}
