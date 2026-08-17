"use client";

import type { AutopilotCandidateDto, AutopilotHomeDto } from "@/lib/recovery/contracts";
import { noticePresentationCopy } from "@/lib/recovery/notice-presentation";
import { MoneyValue, StateBlock } from "./recovery-states";

export function RecoveryAutopilotHome({
  autopilot,
  onAddEvidence,
  onVeto,
  pendingVetoId,
}: {
  autopilot: AutopilotHomeDto;
  onAddEvidence: () => void;
  onVeto: (candidateId: string) => void;
  pendingVetoId: string | null;
}) {
  return (
    <div className="grid max-w-full gap-5 overflow-x-hidden motion-reduce:transition-none">
      <StateBlock
        eyebrow="Autopilot"
        title="Exception-only home"
        detail={autopilot.executionEnabled
          ? "Supported discretionary cases can move after a delivered 48-hour veto. Protected classes never execute."
          : "A standing mandate is active. Cases are classified in shadow. Execution is switched off, so nothing is cancelled from here."}
        tone="neutral"
      >
        <button type="button" className="btn btn-sm btn-ghost" onClick={onAddEvidence}>Add evidence</button>
      </StateBlock>

      <CandidateSection
        title="48-hour veto window"
        empty="No delivered veto notices are waiting."
        items={autopilot.inVeto}
        onVeto={onVeto}
        pendingVetoId={pendingVetoId}
      />
      <CandidateSection
        title="Needs your help"
        empty="No exceptions are open."
        items={autopilot.needsHelp}
        onVeto={onVeto}
        pendingVetoId={pendingVetoId}
      />
      <CandidateSection
        title="Delivery pending"
        empty="No notices are waiting on delivery."
        items={autopilot.awaitingDelivery}
        onVeto={onVeto}
        pendingVetoId={pendingVetoId}
      />
      <CandidateSection title="Watching" empty="No shadow cases yet." items={autopilot.watching} />
      <CandidateSection title="Handled for you" empty="No handled cases yet." items={autopilot.handled} />

      <section className="rounded-2xl border border-line bg-card p-4" aria-labelledby="autopilot-proof">
        <h3 id="autopilot-proof" className="font-display text-lg font-semibold text-(--ink)">Proof and savings</h3>
        {autopilot.proof.length ? (
          <ul className="mt-3 grid gap-2">
            {autopilot.proof.map((window) => (
              <li key={`${window.candidateId}-${window.expectedDebitDate}`} className="text-sm leading-6 text-(--muted)">
                {window.expectedDebitDate}: {window.status}
                {window.status === "MISSING_COVERAGE" || window.status === "PENDING"
                  ? ` — missing ${window.currency} coverage is not a zero saving.`
                  : window.saving
                    ? <> · recorded saving <MoneyValue amount={window.saving} /></>
                    : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-(--muted)">No covered windows have been verified. Missing coverage is not treated as money saved.</p>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-card p-4" aria-labelledby="autopilot-fees">
        <h3 id="autopilot-fees" className="font-display text-lg font-semibold text-(--ink)">Fees and refunds</h3>
        {autopilot.fees.length ? (
          <ul className="mt-3 grid gap-3">
            {autopilot.fees.map((fee) => (
              <li key={fee.currency} className="grid gap-1 text-sm">
                <div>Monitoring <MoneyValue amount={fee.monitoring} /> · covered window <MoneyValue amount={fee.verifiedSaving} /></div>
                <div>Retained <MoneyValue amount={fee.retained} /> · refund credit <MoneyValue amount={fee.refundCredit} /></div>
                <div>Fee collection: {fee.chargeStatus === "FAIL_CLOSED" ? "not charging — fail-closed" : fee.chargeStatus}</div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-(--muted)">No fee period has been invoiced. Fee collection stays fail-closed.</p>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-card p-4" aria-labelledby="autopilot-mandate">
        <h3 id="autopilot-mandate" className="font-display text-lg font-semibold text-(--ink)">Mandate</h3>
        {autopilot.mandate ? (
          <p className="mt-3 text-sm leading-6 text-(--muted)">
            Standing mandate {autopilot.mandate.status === "ACTIVE" ? "is active" : "is revoked"}.
            {" "}This is not a connected, cancelled, saved, or paid state.
          </p>
        ) : (
          <p className="mt-3 text-sm text-(--muted)">No standing mandate is on file for this workspace.</p>
        )}
      </section>
    </div>
  );
}

function CandidateSection({
  title,
  empty,
  items,
  onVeto,
  pendingVetoId,
}: {
  title: string;
  empty: string;
  items: readonly AutopilotCandidateDto[];
  onVeto?: (candidateId: string) => void;
  pendingVetoId?: string | null;
}) {
  const headingId = `autopilot-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <section className="rounded-2xl border border-line bg-card p-4" aria-labelledby={headingId}>
      <h3 id={headingId} className="font-display text-lg font-semibold text-(--ink)">{title}</h3>
      {items.length ? (
        <ul className="mt-3 grid gap-3">
          {items.map((item) => {
            const noticeCopy = noticePresentationCopy(item.noticePresentation);
            const vetoAllowed = Boolean(onVeto) && (
              item.status === "SHADOW"
              || item.status === "NOTICE_QUEUED"
              || item.status === "AUTHORIZED_BY_RULE"
            );
            return (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-(--ink)">{item.merchant}</p>
                  <p className="text-sm text-(--muted)">
                    {item.eligibility} · {item.status}
                    {item.reasons.length ? ` · ${item.reasons.join(", ")}` : ""}
                  </p>
                  {noticeCopy ? <p className="text-sm leading-6 text-(--muted)">{noticeCopy}</p> : null}
                </div>
                <div className="flex items-center gap-2">
                  <MoneyValue amount={item.amount} />
                  {vetoAllowed ? (
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      disabled={pendingVetoId === item.id}
                      onClick={() => onVeto?.(item.id)}
                    >
                      {pendingVetoId === item.id ? "Stopping…" : "Veto"}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-(--muted)">{empty}</p>
      )}
    </section>
  );
}
