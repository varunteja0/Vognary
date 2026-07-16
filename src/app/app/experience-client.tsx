"use client";

import dynamic from "next/dynamic";

const GuestAuditClient = dynamic(() => import("../guest-audit-client"), {
  loading: () => <ExperienceLoading label="Opening the private audit…" />,
});

const VognaryMvpClient = dynamic(() => import("../vognary-mvp-client"), {
  loading: () => <ExperienceLoading label="Opening the workspace…" />,
});

type ExperienceMode = "signed-in" | "guest" | "demo";

export default function ExperienceClient({ experienceMode }: { experienceMode: ExperienceMode }) {
  return experienceMode === "guest"
    ? <GuestAuditClient />
    : <VognaryMvpClient experienceMode={experienceMode} />;
}

function ExperienceLoading({ label }: { label: string }) {
  return (
    <main className="grid min-h-[50vh] place-items-center px-4" aria-busy="true">
      <p className="font-data text-xs uppercase tracking-[0.14em] text-(--muted)" role="status">{label}</p>
    </main>
  );
}
