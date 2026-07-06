export type ConnectorStatus = "live" | "ready-with-env" | "partner-required" | "planned";

export type Connector = {
  id: string;
  name: string;
  phase: string;
  category: string;
  status: ConnectorStatus;
  userValue: string;
  evidence: string;
  requirements: string[];
};

export const connectors: Connector[] = [
  {
    id: "statement-imports",
    name: "Statement Imports",
    phase: "Phase 1",
    category: "Statements",
    status: "live",
    userValue: "Import bank and card statement exports only when direct source access is unavailable.",
    evidence: "Implemented through /api/ingest and browser upload.",
    requirements: ["User-exported CSV statement"],
  },
  {
    id: "pdf-statements",
    name: "PDF Statements",
    phase: "Phase 1",
    category: "Statements",
    status: "live",
    userValue: "Upload readable PDFs when CSV is unavailable, then verify converted rows.",
    evidence: "Implemented with stateless PDF text extraction and warning labels.",
    requirements: ["Readable PDF", "User verification for converted rows"],
  },
  {
    id: "manual-mandates",
    name: "Manual Mandates",
    phase: "Phase 1",
    category: "Mandates",
    status: "live",
    userValue: "Add Apple, Google Play, UPI AutoPay, card mandates, domains, insurance, SIPs, EMIs, and utilities.",
    evidence: "Implemented with manual templates and evidence trail.",
    requirements: ["User checks source app/dashboard"],
  },
  {
    id: "receipt-snippets",
    name: "Receipt Snippets",
    phase: "Phase 2",
    category: "Email",
    status: "live",
    userValue: "Paste invoice/renewal snippets and convert them into recurring candidates.",
    evidence: "Implemented through Receipt Intelligence parser.",
    requirements: ["Receipt text pasted by user"],
  },
  {
    id: "gmail-readonly",
    name: "Gmail Read-Only",
    phase: "Phase 2",
    category: "Email",
    status: "ready-with-env",
    userValue: "Discover subscriptions from receipts and renewal emails without full mailbox storage.",
    evidence: "OAuth start/callback endpoints are implemented and return receipt candidates.",
    requirements: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI", "Google OAuth app verification"],
  },
  {
    id: "openai-anthropic-usage",
    name: "AI Tool Usage Connectors",
    phase: "Phase 2",
    category: "Cloud/SaaS",
    status: "planned",
    userValue: "Compare OpenAI, Claude, Cursor, and similar tool usage against recurring spend.",
    evidence: "Merchant normalization and manual audit support are live; direct usage APIs need credentials/scopes.",
    requirements: ["Provider APIs", "Read-only usage scopes", "Encrypted token storage"],
  },
  {
    id: "team-workspaces",
    name: "Team Review Workflow",
    phase: "Phase 4",
    category: "Teams",
    status: "live",
    userValue: "Assign recurring spend to owners and complete monthly reviews.",
    evidence: "Implemented locally with owner assignment, notes, and review completion.",
    requirements: ["Optional account persistence for multi-user sync"],
  },
  {
    id: "account-aggregator",
    name: "India Account Aggregator",
    phase: "Phase 3",
    category: "Open Finance",
    status: "partner-required",
    userValue: "Consent-based bank account data without password scraping.",
    evidence: "Schema, source model, and production docs are ready; partner/TSP path required.",
    requirements: ["FIU/TSP or regulated partner", "Consent artifact flow", "Compliance review"],
  },
  {
    id: "upi-card-mandates",
    name: "UPI/Card Mandates",
    phase: "Phase 5",
    category: "Mandates",
    status: "partner-required",
    userValue: "Direct mandate visibility for UPI AutoPay and card e-mandates.",
    evidence: "Manual mandate workflow is live; direct sync requires provider/issuer access.",
    requirements: ["Issuer/payment-provider APIs", "Legal approval", "Cancellation/modify policy mapping"],
  },
  {
    id: "bank-issuer-white-label",
    name: "Bank/Issuer White Label",
    phase: "Phase 7",
    category: "B2B",
    status: "partner-required",
    userValue: "Embed Vognary recurring intelligence into bank/card apps.",
    evidence: "Audit APIs and connector registry are ready for pilot conversations.",
    requirements: ["Signed pilot", "Security review", "SLA and data processing agreement"],
  },
];

export function getConnectorSummary() {
  return connectors.reduce<Record<ConnectorStatus, number>>((summary, connector) => {
    summary[connector.status] = (summary[connector.status] ?? 0) + 1;
    return summary;
  }, { live: 0, "ready-with-env": 0, "partner-required": 0, planned: 0 });
}