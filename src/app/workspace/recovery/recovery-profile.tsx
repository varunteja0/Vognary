"use client";

import type { RecoverySessionResponse } from "@/lib/recovery/contracts";
import { formatMoment } from "./labels";
import { StateBlock } from "./recovery-states";

export function RecoveryProfile({
  session,
  workspaceVersion,
  generatedAt,
  commitmentCount,
  evidenceCount,
  signingOut,
  onRequestDelete,
  onSignOut,
}: {
  session: RecoverySessionResponse | null;
  workspaceVersion: number | null;
  generatedAt: string | null;
  commitmentCount: number;
  evidenceCount: number;
  signingOut: boolean;
  onRequestDelete: (returnFocusId: string) => void;
  onSignOut: () => void;
}) {
  return (
    <div className="grid gap-5">
      <section aria-labelledby="recovery-account-heading" className="panel p-4 sm:p-5">
        <h3 id="recovery-account-heading" className="folio" data-folio="10">Account</h3>
        {session?.authenticated ? (
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <Fact label="Signed in as" value={session.session.email} />
            <Fact label="Workspace" value={session.session.workspaceId} />
            <Fact label="Session expires" value={formatMoment(session.session.expiresAt)} />
            <Fact label="Session cookie" value={session.configuration.cookieName} />
          </dl>
        ) : (
          <p className="mt-3 text-sm leading-6 text-(--muted)">No signed-in session was reported for this device.</p>
        )}
        <button type="button" onClick={onSignOut} disabled={signingOut} className="btn btn-sm btn-ghost mt-4">
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </section>

      <section aria-labelledby="recovery-persistence-heading" className="panel p-4 sm:p-5">
        <h3 id="recovery-persistence-heading" className="folio" data-folio="11">Where this workspace lives</h3>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-(--ink-soft)">
          Your evidence, commitments, corrections, and decisions are saved on the server, not in this browser. Reloading this page, closing the tab,
          or signing in again later shows the same saved workspace. Nothing on this screen was reconstructed locally.
        </p>
        <dl className="mt-4 grid gap-3 sm:grid-cols-3">
          <Fact label="Saved version" value={workspaceVersion === null ? "Not loaded" : `Version ${workspaceVersion}`} />
          <Fact label="This view generated" value={generatedAt ? formatMoment(generatedAt) : "Not loaded"} />
          <Fact label="Held for you" value={`${commitmentCount} commitments · ${evidenceCount} evidence items`} />
        </dl>
      </section>

      <section aria-labelledby="recovery-export-heading" className="panel p-4 sm:p-5">
        <h3 id="recovery-export-heading" className="folio" data-folio="12">Export</h3>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-(--muted)">
          Account settings owns the live privacy export. It includes the authorized Recovery evidence, commitments, corrections, decisions,
          versions, and change history from the server while excluding authentication credentials and raw payload bodies.
        </p>
        <a href="/profile#privacy-export" className="btn btn-sm btn-ghost mt-4">Open canonical privacy export</a>
      </section>

      <StateBlock
        eyebrow="Danger zone"
        title="Delete saved workspace data"
        detail="Deleting removes the saved evidence, commitments, corrections, and decisions behind everything you have seen here. It cannot be undone."
        tone="danger"
      >
        <button
          type="button"
          id="recovery-delete-trigger"
          onClick={() => onRequestDelete("recovery-delete-trigger")}
          className="btn btn-sm btn-ember"
        >
          Delete saved workspace data…
        </button>
      </StateBlock>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="inset p-3">
      <dt className="eyebrow eyebrow-xs">{label}</dt>
      <dd className="mt-1.5 wrap-break-word font-data text-sm text-(--ink)">{value}</dd>
    </div>
  );
}
