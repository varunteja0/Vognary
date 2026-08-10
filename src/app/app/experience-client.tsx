"use client";

import dynamic from "next/dynamic";
import type { RecoveryCutoverStatus } from "@/lib/recovery/contracts";

const GuestAuditClient = dynamic(() => import("../guest-audit-client"), {
  loading: () => <ExperienceLoading label="Opening the private audit…" />,
});

// Signed-in readers get the Recovery workspace. The legacy monolith stays in the
// tree, untouched, as the rollback reference for this switch.
const RecoveryWorkspaceClient = dynamic(() => import("../workspace/recovery/recovery-workspace-client"), {
  loading: () => <ExperienceLoading label="Opening the workspace…" />,
});

export type GmailConnectAvailability = { available: boolean; label: string; meaning: string };

export default function ExperienceClient({
  signedIn,
  recoveryCutover,
  gmailConnect,
}: {
  signedIn: boolean;
  recoveryCutover: RecoveryCutoverStatus | null;
  gmailConnect: GmailConnectAvailability;
}) {
  if (!signedIn) return <GuestAuditClient gmailConnect={gmailConnect} />;
  if (recoveryCutover?.status === "LEGACY_DATA_REQUIRES_MIGRATION") {
    return <LegacyContinuityBlock counts={recoveryCutover.counts} />;
  }
  return <RecoveryWorkspaceClient />;
}

function LegacyContinuityBlock({ counts }: { counts: RecoveryCutoverStatus["counts"] }) {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  return (
    <main className="mx-auto grid min-h-[60vh] w-full max-w-3xl place-content-center px-4 py-12 text-foreground">
      <section className="panel border border-ochre p-5 sm:p-7" role="alert">
        <p className="eyebrow eyebrow-xs text-ochre">Recovery cutover blocked</p>
        <h1 className="mt-2 font-display text-2xl font-semibold text-(--ink)">Existing saved data needs migration</h1>
        <p className="mt-3 text-sm leading-6 text-(--ink-soft)">
          This workspace has {total} record{total === 1 ? "" : "s"} in the previous signed workspace. Recovery will not show an empty ledger or run two live truths. Nothing was moved or deleted.
        </p>
        <dl className="mt-4 grid gap-2 sm:grid-cols-2">
          {Object.entries(counts).filter(([, count]) => count > 0).map(([label, count]) => (
            <div key={label} className="inset flex items-center justify-between gap-3 p-3">
              <dt className="text-sm text-(--muted)">{label.replace(/([A-Z])/g, " $1").toLowerCase()}</dt>
              <dd className="font-data text-sm text-(--ink)">{count}</dd>
            </div>
          ))}
        </dl>
        <a href="/profile#privacy-export" className="btn btn-primary mt-5">Open canonical data export</a>
      </section>
    </main>
  );
}

function ExperienceLoading({ label }: { label: string }) {
  return (
    <main className="grid min-h-[50vh] place-items-center px-4" aria-busy="true">
      <p className="font-data text-xs uppercase tracking-[0.14em] text-(--muted)" role="status">{label}</p>
    </main>
  );
}
