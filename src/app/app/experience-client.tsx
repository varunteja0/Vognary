"use client";

import dynamic from "next/dynamic";

const GuestAuditClient = dynamic(() => import("../guest-audit-client"), {
  loading: () => <ExperienceLoading label="Opening the private audit…" />,
});

const VognaryMvpClient = dynamic(() => import("../vognary-mvp-client"), {
  loading: () => <ExperienceLoading label="Opening the workspace…" />,
});

export type GmailConnectAvailability = { available: boolean; label: string; meaning: string };

export default function ExperienceClient({ signedIn, gmailConnect }: { signedIn: boolean; gmailConnect: GmailConnectAvailability }) {
  return signedIn ? <VognaryMvpClient /> : <GuestAuditClient gmailConnect={gmailConnect} />;
}

function ExperienceLoading({ label }: { label: string }) {
  return (
    <main className="grid min-h-[50vh] place-items-center px-4" aria-busy="true">
      <p className="font-data text-xs uppercase tracking-[0.14em] text-(--muted)" role="status">{label}</p>
    </main>
  );
}
