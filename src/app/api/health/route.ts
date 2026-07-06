import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    service: "vognary-web",
    status: "ok",
    mode: "self-serve-stateless-audit",
    timestamp: new Date().toISOString(),
    components: {
      web: "ready",
      auditEngine: "ready",
      csvIngestion: "ready",
      auditApi: "ready",
      pdfIngestion: "ready-beta",
      manualCommitments: "ready",
      reportExport: "ready",
      receiptParser: "ready-beta",
      waitlist: process.env.WAITLIST_WEBHOOK_URL ? "configured" : "preview-not-persisted",
      connectorRegistry: "ready",
      checkout: process.env.PAYMENT_LINK_FOUNDER_PRO ? "configured" : "ready-with-payment-link-env",
      persistentStorage: "not-configured",
      gmailReceipts: process.env.GOOGLE_CLIENT_ID ? "configured" : "not-configured",
      accountAggregator: "not-configured",
      upiMandates: "not-configured",
    },
    productionBoundary: "Ready for self-serve stateless audits. Optional connected-account features require auth, encrypted storage, privacy/legal review, and approved integrations.",
  });
}