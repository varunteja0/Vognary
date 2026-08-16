"use client";

import { useState, type ReactNode } from "react";
import type { ReceiptInboxStatusDto, RecoveryEvidenceSourceDto } from "@/lib/recovery/contracts";
import { formatMoment } from "./labels";
import { AuthRequiredBlock, LoadingBlock, StateBlock } from "./recovery-states";
import type { LoadState, PendingMutation } from "./state";

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
  manualFallback,
  manualFallbackOpen,
  onManualFallbackToggle,
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
  manualFallback: ReactNode;
  manualFallbackOpen: boolean;
  onManualFallbackToggle: (open: boolean) => void;
}) {
  const [copyStatus, setCopyStatus] = useState("");
  const alias = receiptInbox?.alias ?? null;

  async function copyAddress() {
    if (!alias) return;
    try {
      await navigator.clipboard.writeText(alias.address);
      setCopyStatus("Address copied.");
    } catch {
      setCopyStatus("Could not copy automatically. Select the address and copy it.");
    }
  }

  if (!receiptInboxPubliclyAvailable) {
    return (
      <div className="grid gap-3">
        <EvidenceSourceList
          sources={evidenceSources}
          canManage={canManageEvidenceSources}
          pendingMutation={pendingMutation}
          onDisconnect={onDisconnectEvidenceSource}
          onReconnect={onReconnectEvidenceSource}
        />
        <p className="border-y border-line px-1 py-3 text-sm leading-6 text-(--muted)">
          <strong className="text-(--ink-soft)">Manual evidence only.</strong> Receipt forwarding is not available yet. Nothing is connected, and Vognary does not access your inbox.
        </p>
        {manualFallback}
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <EvidenceSourceList
        sources={evidenceSources}
        canManage={canManageEvidenceSources}
        pendingMutation={pendingMutation}
        onDisconnect={onDisconnectEvidenceSource}
        onReconnect={onReconnectEvidenceSource}
      />
      <section aria-labelledby="receipt-inbox-heading" className="panel p-4 sm:p-6">
        <p className="eyebrow eyebrow-xs text-ochre">Recommended source</p>
        <h3 id="receipt-inbox-heading" className="mt-3 font-display text-2xl font-semibold text-(--ink)">Your Vognary receipt address</h3>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-(--muted)">
          Vognary never accesses or scans your inbox. Messages sent to that private address are processed as receipt evidence; keep the address private and forward only billing mail you want Vognary to review.
        </p>

        {receiptInbox?.gmailVerification ? (
          <div className="mt-5">
            <StateBlock
              eyebrow="Gmail is waiting for you"
              title="Confirm forwarding in Gmail to finish setup"
              detail="Gmail sent a confirmation request to your Vognary receipt address. Gmail forwards nothing until it is confirmed."
              tone="caution"
            >
              <div className="grid gap-3">
                {receiptInbox.gmailVerification.code ? (
                  <p className="text-sm leading-6 text-(--ink)">
                    Confirmation code: <span className="font-mono font-semibold">{receiptInbox.gmailVerification.code}</span>
                    {" "}— paste this into Gmail&apos;s Forwarding settings.
                  </p>
                ) : null}
                {receiptInbox.gmailVerification.verificationUrl ? (
                  <a
                    href={receiptInbox.gmailVerification.verificationUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="btn btn-sm btn-primary justify-self-start"
                  >
                    Confirm forwarding with Google
                  </a>
                ) : null}
              </div>
            </StateBlock>
          </div>
        ) : null}

        {sourceStatus.kind === "AUTH_REQUIRED" ? (
          <div className="mt-5"><AuthRequiredBlock /></div>
        ) : sourceStatus.kind === "FAILED" && receiptInbox ? (
          <div className="mt-5">
            <StateBlock
              eyebrow="Source update failed"
              title="The last receipt-address action was not saved"
              detail={sourceStatus.failure.error.message}
              tone="caution"
            >
              <button type="button" onClick={onRetry} className="btn btn-sm btn-ghost">Reload source status</button>
            </StateBlock>
          </div>
        ) : sourceStatus.kind === "LOADING" && !receiptInbox ? (
          <div className="mt-5"><LoadingBlock label="Opening your receipt source…" /></div>
        ) : sourceStatus.kind === "FAILED" && !receiptInbox ? (
          <div className="mt-5">
            <StateBlock
              eyebrow="Forwarding unavailable"
              title="A receipt address cannot be created right now"
              detail="Nothing was connected. You can retry or use the manual fallback below."
              tone="caution"
            >
              <button type="button" onClick={onRetry} className="btn btn-sm btn-ghost">Try again</button>
            </StateBlock>
          </div>
        ) : receiptInbox?.state === "UNAVAILABLE" ? (
          <div className="mt-5">
            <StateBlock
              eyebrow="Forwarding unavailable"
              title="Receipt forwarding is not active yet"
              detail="Use the manual fallback below. Nothing is connected, and Vognary does not access your inbox."
              tone="caution"
            />
          </div>
        ) : receiptInbox?.state === "NOT_PROVISIONED" || !receiptInbox ? (
          <div className="mt-5 border-t border-line pt-5">
            <p className="text-sm leading-6 text-(--ink-soft)">
              Create one private address for this account. Only mail sent to that address enters Vognary.
            </p>
            <button type="button" onClick={onProvision} disabled={pendingAction !== null} className="btn btn-primary mt-4">
              {pendingAction === "PROVISION" ? "Creating address…" : "Create receipt address"}
            </button>
          </div>
        ) : receiptInbox.state === "REVOKED" ? (
          <div className="mt-5">
            <StateBlock
              eyebrow="Stopped"
              title="This receipt address no longer accepts mail"
              detail="Create a new address when you want to start receiving forwarded billing emails again."
            >
              <button type="button" onClick={onProvision} disabled={pendingAction !== null} className="btn btn-sm btn-primary">
                {pendingAction === "PROVISION" ? "Creating address…" : "Create receipt address"}
              </button>
            </StateBlock>
          </div>
        ) : alias ? (
          <div className="mt-5 grid gap-5 border-t border-line pt-5">
            <div>
              <label htmlFor="receipt-inbox-address" className="field-label">Send software receipts to</label>
              <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                <input id="receipt-inbox-address" className="field field-mono min-w-0" value={alias.address} readOnly />
                <button type="button" onClick={() => void copyAddress()} className="btn btn-ghost shrink-0">Copy address</button>
              </div>
              <p role="status" aria-live="polite" className="mt-2 min-h-5 text-xs text-(--muted)">{copyStatus}</p>
            </div>

            <ReceiptInboxState status={receiptInbox} />

            {receiptInbox.state === "READY" ? (
              <div className="border-t border-line pt-5">
                <h4 className="font-display text-lg font-semibold text-(--ink)">Keep Vognary current</h4>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-(--muted)">
                  Forward billing emails manually for now. Gmail automatic forwarding can require a verification message that Vognary does not currently surface, so do not use this address in Gmail’s automatic-forwarding setup yet.
                </p>
              </div>
            ) : null}

            <details className="border-t border-line pt-4">
              <summary className="cursor-pointer text-sm font-medium text-(--ink-soft)">Receipt address controls</summary>
              <p className="mt-3 text-xs leading-5 text-(--muted)">
                Rotating stops the current address and creates a new one. Stopping prevents future mail from being routed to this account.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={onRotate} disabled={pendingAction !== null} className="btn btn-sm btn-ghost">
                  {pendingAction === "ROTATE" ? "Rotating…" : "Rotate address"}
                </button>
                <button type="button" onClick={onRevoke} disabled={pendingAction !== null} className="btn btn-sm btn-ember">
                  {pendingAction === "REVOKE" ? "Stopping…" : "Stop receiving"}
                </button>
              </div>
            </details>
          </div>
        ) : null}
      </section>

      <details
        open={manualFallbackOpen}
        onToggle={(event) => onManualFallbackToggle(event.currentTarget.open)}
        className="border-y border-line"
      >
        <summary className="cursor-pointer px-4 py-4 font-display text-base font-semibold text-(--ink) sm:px-6">Manual fallback</summary>
        <div className="border-t border-line p-4 sm:p-6">{manualFallback}</div>
      </details>
    </div>
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
  return (
    <section className="panel p-4 sm:p-6" aria-labelledby="recovery-evidence-sources">
      <p className="eyebrow eyebrow-xs text-ochre">Cited Recovery sources</p>
      <h3 id="recovery-evidence-sources" className="mt-3 font-display text-2xl font-semibold text-(--ink)">Evidence sources in this workspace</h3>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-(--muted)">
        These are the receipt and file sources currently cited for classification. Disconnecting a source stops it supporting future classification and withdraws affected queued Autopilot cases. It does not rotate the receipt address. Reconnect is explicit. An eligible case can return only to shadow watching. An old notice, 48-hour clock, or authorization is never restored.
      </p>
      {sources.length ? (
        <ul className="mt-5 grid gap-3">
          {sources.map((source) => {
            const busy = pendingSourceId === source.id;
            return (
              <li key={source.id} className="rounded-2xl border border-line p-4">
                <p className="font-medium text-(--ink)">{source.label}</p>
                <p className="mt-1 text-sm text-(--muted)">
                  {source.kind} · {source.status === "CONNECTED" ? "Connected" : "Disconnected"}
                  {source.cited ? " · currently cited" : " · not in the current classification"}
                </p>
                {canManage ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {source.status === "CONNECTED" ? (
                      <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => onDisconnect(source.id)}>
                        {busy && pendingMutation?.kind === "SOURCE_DISCONNECT" ? "Disconnecting…" : "Disconnect source"}
                      </button>
                    ) : (
                      <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => onReconnect(source.id)}>
                        {busy && pendingMutation?.kind === "SOURCE_RECONNECT" ? "Reconnecting…" : "Reconnect source"}
                      </button>
                    )}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-(--muted)">Only a workspace admin can disconnect or reconnect a source.</p>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-5 text-sm text-(--muted)">No Recovery evidence sources are on file yet.</p>
      )}
    </section>
  );
}

function ReceiptInboxState({ status }: { status: ReceiptInboxStatusDto }) {
  if (status.state === "UNAVAILABLE" || status.state === "NOT_PROVISIONED" || status.state === "REVOKED") return null;
  const contentByState: Record<typeof status.state, {
    eyebrow: string;
    title: string;
    detail: string;
    tone: "neutral" | "caution";
  }> = {
    WAITING: {
      eyebrow: "Waiting",
      title: "Waiting for a receipt",
      detail: "Forward a software billing email to the address above. This page updates when Vognary receives it.",
      tone: "neutral" as const,
    },
    RECEIVED: {
      eyebrow: "Received",
      title: "Receipt received",
      detail: status.lastReceivedAt ? `Received ${formatMoment(status.lastReceivedAt)}. Processing has not started yet.` : "The email arrived. Processing has not started yet.",
      tone: "neutral" as const,
    },
    PROCESSING: {
      eyebrow: "Processing",
      title: "Looking for renewals",
      detail: "Vognary is checking the receipt. You can leave and return later.",
      tone: "neutral" as const,
    },
    READY: {
      eyebrow: "Up to date",
      title: "Latest receipt processed",
      detail: status.lastProcessedAt ? `Processed ${formatMoment(status.lastProcessedAt)}. Open Home to review what changed.` : "The latest receipt was processed. Open Home to review what changed.",
      tone: "neutral" as const,
    },
    FAILED: {
      eyebrow: "Needs another receipt",
      title: "Vognary could not prove a renewal",
      detail: status.lastFailureCode
        ? `The email arrived, but no receipt could be read from it (${status.lastFailureCode}). Forward one that shows the service name, amount, and date in the message or as a PDF invoice. Scans and screenshots cannot be read.`
        : "The email arrived, but no receipt could be read from it. Forward one that shows the service name, amount, and date in the message or as a PDF invoice. Scans and screenshots cannot be read.",
      tone: "caution" as const,
    },
  };
  const content = contentByState[status.state];
  return <StateBlock {...content} />;
}
