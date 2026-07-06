import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    service: "vognary-web",
    status: "ok",
    mode: "private-beta-local-audit",
    timestamp: new Date().toISOString(),
    components: {
      web: "ready",
      auditEngine: "ready",
      csvIngestion: "ready",
      auditApi: "ready",
      manualCommitments: "ready",
      reportExport: "ready",
      persistentStorage: "not-configured",
      gmailReceipts: "not-configured",
      accountAggregator: "not-configured",
      upiMandates: "not-configured",
    },
    productionBoundary: "Usable for private beta audits. Regulated production requires auth, encrypted storage, privacy/legal review, and approved integrations.",
  });
}