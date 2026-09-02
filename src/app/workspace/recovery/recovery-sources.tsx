"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { ReceiptInboxStatusDto, RecoveryEvidenceSourceDto } from "@/lib/recovery/contracts";
import { customerInboxStatus, customerInboxStatusLabel, customerPhrases, gmailWizardStep, inboxFailureCopy, type CustomerInboxStatus } from "./present";
import { ReceiptBillingSetup, SourcesAdvancedHelp } from "./recovery-billing-setup";
import { AuthRequiredBlock, LoadingBlock, StateBlock } from "./recovery-states";
import type { LoadState, PendingMutation } from "./state";
import { formatMoment, sourceLabels } from "./labels";

export function RecoverySources({
  receiptInboxPubliclyAvailable,
  receiptInbox,
  sourceStatus,
  pendingAction,
  evidenceSources,
  canManageEvidenceSources,
  pendingMutation,
  onDisconnectEvidenceSource,
  onReconnectEvidenceSource,
  onProvision,
  onRotate,
  onRevoke,
  onRetry,
  onAddBills,
}: {
  receiptInboxPubliclyAvailable: boolean;
  receiptInbox: ReceiptInboxStatusDto | null;
  sourceStatus: LoadState;
  pendingAction: "PROVISION" | "ROTATE" | "REVOKE" | null;
  evidenceSources: readonly RecoveryEvidenceSourceDto[];
  canManageEvidenceSources: boolean;
  pendingMutation: PendingMutation | null;
  onDisconnectEvidenceSource: (sourceId: string) => void;
  onReconnectEvidenceSource: (sourceId: string) => void;
  onProvision: () => void;
  onRotate: () => void;
  onRevoke: () => void;
  onRetry: () => void;
  onAddBills: () => void;
  manualFallback?: ReactNode;
  manualFallbackOpen?: boolean;
  onManualFallbackToggle?: (open: boolean) => void;
  firstValue?: boolean;
  keepCurrentOpen?: boolean;
  onKeepCurrentToggle?: (open: boolean) => void;
}) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [localStep, setLocalStep] = useState<1 | 2 | 3>(1);
  const inboxStatus = customerInboxStatus(receiptInbox);

  function openSetup() {
    if (!receiptInbox?.alias && pendingAction === null) onProvision();
    setLocalStep(gmailWizardStep(receiptInbox) === 4 ? 3 : gmailWizardStep(receiptInbox) === 2 ? 2 : 1);
    setWizardOpen(true);
  }

  if (!receiptInboxPubliclyAvailable) {
    return (
      <div className="w-full max-w-2xl">
        <div className="stack-page">
          <StayUpToDateHeading />
          <p className="text-sm leading-6 text-(--muted)">
            Automatic forwarding is not available yet. Add a bill manually. {customerPhrases.trustOnce}{" "}
            <Link href="/security" className="link-quiet">See how your data is handled</Link>
          </p>
          <ManualAdd onAddBills={onAddBills} />
          <AdvancedPanel
            receiptInbox={null}
            evidenceSources={evidenceSources}
            canManage={canManageEvidenceSources}
            pendingAction={pendingAction}
            pendingMutation={pendingMutation}
            onDisconnect={onDisconnectEvidenceSource}
            onReconnect={onReconnectEvidenceSource}
            onRotate={onRotate}
            onRevoke={onRevoke}
          />
        </div>
      </div>
    );
  }

  if (sourceStatus.kind === "AUTH_REQUIRED") return <AuthRequiredBlock />;
  if (sourceStatus.kind === "LOADING" && !receiptInbox) return <LoadingBlock label="Opening sources…" />;
  if (sourceStatus.kind === "FAILED" && !receiptInbox) {
    return (
      <StateBlock eyebrow="Unavailable" title="Sources could not be opened" detail="You can still add a bill manually." tone="caution">
        <button type="button" onClick={onRetry} className="btn btn-sm btn-ghost">Try again</button>
        <button type="button" onClick={onAddBills} className="btn btn-sm btn-primary">{customerPhrases.addBills}</button>
      </StateBlock>
    );
  }

  return (
    <div className="w-full max-w-2xl">
      <div className="stack-page">
        <StayUpToDateHeading />

        <section className="grid gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className="font-display text-lg font-semibold text-(--ink)">{customerPhrases.privateInbox}</h3>
            <span className={inboxPill(inboxStatus)}>{customerInboxStatusLabel(inboxStatus)}</span>
          </div>
          <p className="text-sm leading-6 text-(--muted)">{customerPhrases.forwardMatching}</p>
          {inboxStatus === "ON" && !wizardOpen ? (
            <p className="text-sm leading-6 text-(--muted)">Matching billing mail should arrive on its own.</p>
          ) : wizardOpen && receiptInbox?.alias ? (
            <ReceiptBillingSetup
              receiptInbox={receiptInbox}
              localStep={localStep}
              onAdvance={() => setLocalStep((step) => (step === 3 ? 3 : (step + 1) as 1 | 2 | 3))}
            />
          ) : (
            <button type="button" onClick={openSetup} disabled={pendingAction !== null} className="btn btn-primary justify-self-start">
              {pendingAction === "PROVISION" ? "Creating address…" : inboxStatus === "NOT_SET_UP" ? "Set up" : "Continue setup"}
            </button>
          )}
          {receiptInbox?.state === "FAILED" ? (
            <StateBlock
              eyebrow="Needs another bill"
              title={inboxFailureCopy(receiptInbox.lastFailureCode).title}
              detail={inboxFailureCopy(receiptInbox.lastFailureCode).detail}
              tone="caution"
            >
              <button type="button" onClick={onAddBills} className="btn btn-sm btn-primary">{customerPhrases.addBills}</button>
            </StateBlock>
          ) : null}
          <p className="text-sm leading-6 text-(--muted)">
            {customerPhrases.trustOnce} <Link href="/security" className="link-quiet">See how your data is handled</Link>
          </p>
        </section>

        <ManualAdd onAddBills={onAddBills} />

        {receiptInbox?.alias ? (
          <details>
            <summary className="cursor-pointer text-sm font-medium text-(--ink-soft)">Older bills</summary>
            <div className="mt-3"><SourcesAdvancedHelp receiptInbox={receiptInbox} /></div>
          </details>
        ) : (
          <details>
            <summary className="cursor-pointer text-sm font-medium text-(--ink-soft)">Using Outlook?</summary>
            <div className="mt-3">{receiptInbox ? <SourcesAdvancedHelp receiptInbox={receiptInbox} /> : <p className="text-sm text-(--muted)">Set up the private inbox first.</p>}</div>
          </details>
        )}

        {sourceStatus.kind === "FAILED" && receiptInbox ? (
          <StateBlock eyebrow="Source update failed" title="The last address action was not saved" detail={sourceStatus.failure.error.message} tone="caution">
            <button type="button" onClick={onRetry} className="btn btn-sm btn-ghost">Reload</button>
          </StateBlock>
        ) : null}

        <AdvancedPanel
          receiptInbox={receiptInbox}
          evidenceSources={evidenceSources}
          canManage={canManageEvidenceSources}
          pendingAction={pendingAction}
          pendingMutation={pendingMutation}
          onDisconnect={onDisconnectEvidenceSource}
          onReconnect={onReconnectEvidenceSource}
          onRotate={onRotate}
          onRevoke={onRevoke}
        />
      </div>
    </div>
  );
}

function inboxPill(status: CustomerInboxStatus): string {
  if (status === "ON") return "pill pill-ready";
  if (status === "NEEDS_HELP") return "pill pill-blocked";
  if (status === "NOT_SET_UP") return "pill pill-planned";
  return "pill pill-partial";
}

function StayUpToDateHeading() {
  return <p className="eyebrow eyebrow-xs">{customerPhrases.stayUpToDate}</p>;
}

function ManualAdd({ onAddBills }: { onAddBills: () => void }) {
  return (
    <section className="grid gap-3">
      <h3 className="font-display text-lg font-semibold text-(--ink)">{customerPhrases.addBillManually}</h3>
      <button type="button" onClick={onAddBills} className="btn btn-ghost justify-self-start">{customerPhrases.addBills}</button>
    </section>
  );
}

function AdvancedPanel({
  receiptInbox,
  evidenceSources,
  canManage,
  pendingAction,
  pendingMutation,
  onDisconnect,
  onReconnect,
  onRotate,
  onRevoke,
}: {
  receiptInbox: ReceiptInboxStatusDto | null;
  evidenceSources: readonly RecoveryEvidenceSourceDto[];
  canManage: boolean;
  pendingAction: "PROVISION" | "ROTATE" | "REVOKE" | null;
  pendingMutation: PendingMutation | null;
  onDisconnect: (sourceId: string) => void;
  onReconnect: (sourceId: string) => void;
  onRotate: () => void;
  onRevoke: () => void;
}) {
  return (
    <details>
      <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-(--ink-soft)">Advanced</summary>
      <div className="mt-4 grid gap-4">
        {receiptInbox?.alias ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onRotate} disabled={pendingAction !== null} className="btn btn-sm btn-ghost">
              {pendingAction === "ROTATE" ? "Rotating…" : "Rotate address"}
            </button>
            <button type="button" onClick={onRevoke} disabled={pendingAction !== null} className="btn btn-sm btn-ember">
              {pendingAction === "REVOKE" ? "Stopping…" : "Stop receiving"}
            </button>
          </div>
        ) : null}
        <EvidenceSourceList
          sources={evidenceSources}
          canManage={canManage}
          pendingMutation={pendingMutation}
          onDisconnect={onDisconnect}
          onReconnect={onReconnect}
        />
      </div>
    </details>
  );
}

function EvidenceSourceList({
  sources,
  canManage,
  pendingMutation,
  onDisconnect,
  onReconnect,
}: {
  sources: readonly RecoveryEvidenceSourceDto[];
  canManage: boolean;
  pendingMutation: PendingMutation | null;
  onDisconnect: (sourceId: string) => void;
  onReconnect: (sourceId: string) => void;
}) {
  const pendingSourceId = pendingMutation?.kind === "SOURCE_DISCONNECT" || pendingMutation?.kind === "SOURCE_RECONNECT"
    ? pendingMutation.sourceId
    : null;
  if (!sources.length) return <p className="text-sm text-(--muted)">No bills added yet.</p>;
  return (
    <ul className="grid gap-3">
      {sources.map((source) => {
        const busy = pendingSourceId === source.id;
        return (
          <li key={source.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
            <div>
              <p className="text-sm font-medium text-(--ink)">{source.label}</p>
              <p className="text-xs text-(--muted)">
                {sourceLabels[source.kind]} · {source.status === "CONNECTED" ? "Connected" : "Disconnected"}
                {source.disconnectedAt ? ` · stopped ${formatMoment(source.disconnectedAt)}` : ""}
              </p>
            </div>
            {canManage ? (
              source.status === "CONNECTED" ? (
                <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => onDisconnect(source.id)}>
                  {busy && pendingMutation?.kind === "SOURCE_DISCONNECT" ? "Disconnecting…" : "Disconnect source"}
                </button>
              ) : (
                <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => onReconnect(source.id)}>
                  {busy && pendingMutation?.kind === "SOURCE_RECONNECT" ? "Reconnecting…" : "Reconnect source"}
                </button>
              )
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
