"use client";

import { standingMandateSignedText } from "@/lib/recovery/standing-mandate";
import type { AutopilotAttemptDto, AutopilotCandidateDto, StandingMandateDto } from "@/lib/recovery/contracts";
import { StateBlock } from "./recovery-states";

export function RecoveryMandate({
  mandate,
  executionEnabled,
  noticeEnabled,
  pending,
  online,
  canSign,
  canOperate,
  handled,
  needsHelp,
  attempts,
  onSign,
  onRevoke,
}: {
  mandate: StandingMandateDto | null;
  executionEnabled: boolean;
  noticeEnabled: boolean;
  pending: boolean;
  online: boolean;
  canSign: boolean;
  canOperate: boolean;
  handled: readonly AutopilotCandidateDto[];
  needsHelp: readonly AutopilotCandidateDto[];
  attempts: readonly AutopilotAttemptDto[];
  onSign: () => void;
  onRevoke: () => void;
}) {
  const active = mandate?.status === "ACTIVE";
  const operatorCases = [...handled, ...needsHelp];
  return (
    <div className="grid gap-5">
      <StateBlock
        eyebrow="Standing mandate"
        title={active ? "This workspace has an active standing mandate" : "No standing mandate is signed"}
        detail={active
          ? "Vognary may only queue supported discretionary cases after a delivered 48-hour veto notice. Execution stays off until the founder switch is on."
          : "Signing authorizes Vognary to cancel supported discretionary subscriptions after a delivered 48-hour veto notice. EMI, SIP, insurance, utilities, and cloud infrastructure stay protected. No merchant cancellation route is proven yet."}
        tone={active ? "neutral" : "caution"}
      />

      <section className="rounded-2xl border border-line bg-card p-4">
        <h3 className="font-display text-lg font-semibold text-(--ink)">Exact signed text</h3>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-(--muted)">{active ? mandate.signedText : standingMandateSignedText}</p>
        {active ? (
          <p className="mt-3 break-all font-data text-xs text-(--muted)">
            Terms {mandate.termsVersion} · SHA-256 {mandate.signedTextHash} · signed {mandate.signedAt}
          </p>
        ) : null}
      </section>

      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-line bg-card p-4">
          <dt className="text-xs uppercase tracking-wide text-(--muted)">Notice delivery</dt>
          <dd className="mt-1 text-sm text-(--ink)">{noticeEnabled ? "Enabled" : "Off — veto notices are not sent"}</dd>
        </div>
        <div className="rounded-2xl border border-line bg-card p-4">
          <dt className="text-xs uppercase tracking-wide text-(--muted)">Execution</dt>
          <dd className="mt-1 text-sm text-(--ink)">{executionEnabled ? "Enabled for proven supported cases after the veto clock" : "Off — no cancellation is executed"}</dd>
        </div>
      </dl>

      {canSign ? (
        <div className="flex flex-wrap gap-2">
          {active ? (
            <button type="button" className="btn btn-primary" disabled={pending || !online} onClick={onRevoke}>
              {pending ? "Revoking…" : "Revoke this mandate"}
            </button>
          ) : (
            <button type="button" className="btn btn-primary" disabled={pending || !online} onClick={onSign}>
              {pending ? "Saving…" : "I accept this standing mandate"}
            </button>
          )}
        </div>
      ) : (
        <p className="text-sm text-(--muted)">Only a workspace owner can sign or revoke the standing mandate.</p>
      )}

      {canOperate ? (
        <section className="rounded-2xl border border-line bg-card p-4" aria-labelledby="autopilot-operator">
          <h3 id="autopilot-operator" className="font-display text-lg font-semibold text-(--ink)">Operator controls</h3>
          <p className="mt-3 text-sm leading-6 text-(--muted)">
            Exact block reasons, attempt history, operator minutes, and proof kind stay on the server. Operators cannot mark financial savings verified.
          </p>
          {operatorCases.length ? (
            <ul className="mt-3 grid gap-2 text-sm">
              {operatorCases.map((item) => (
                <li key={item.id}>
                  {item.merchant}: {item.status} · {item.eligibility}
                  {item.exceptionCode ? ` · ${item.exceptionCode}` : ""}
                  {item.providerId ? ` · provider ${item.providerId}` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-(--muted)">No handled or exception cases are on file.</p>
          )}
          {attempts.length ? (
            <ul className="mt-3 grid gap-2 text-sm" aria-label="Attempt history">
              {attempts.map((attempt) => (
                <li key={`${attempt.operationKey}-${attempt.attemptNo}`}>
                  Attempt {attempt.attemptNo}: {attempt.status}
                  {attempt.outcome ? ` · ${attempt.outcome}` : ""}
                  {attempt.operatorMinutes ? ` · ${attempt.operatorMinutes} min` : ""}
                  {attempt.proofKind ? ` · ${attempt.proofKind}` : ""}
                  {attempt.failureReason ? ` · ${attempt.failureReason}` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-(--muted)">No operator attempts are on file.</p>
          )}
          <p className="mt-3 text-sm leading-6 text-(--muted)">
            Provider kill switches are founder/internal-operator only. Workspace admins cannot globally disable a merchant route.
          </p>
        </section>
      ) : null}
    </div>
  );
}
