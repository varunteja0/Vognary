/**
 * Honest source catalog.
 *
 * Connectors are sensors. Only a source that actually works end-to-end in this
 * deployment may be offered as setup. Reserved mailbox APIs stay Planned.
 * The ingestion envelope in ingestion-envelope.ts remains Source Adapter 0.
 */

import { isRecoveryGmailOauthReady } from "@/lib/recovery/gmail-oauth";

export const sourceCatalogIds = ["BILLING_INBOX", "GOOGLE_WORKSPACE", "MICROSOFT_365", "ZOHO_BOOKS"] as const;
export type SourceCatalogId = (typeof sourceCatalogIds)[number];

export const sourceAvailabilityStates = ["LIVE", "SETUP", "CONNECTED", "PLANNED", "UNAVAILABLE"] as const;
export type SourceAvailabilityState = (typeof sourceAvailabilityStates)[number];

export const sourceCatalogActions = ["SETUP", "MANAGE", "NONE"] as const;
export type SourceCatalogAction = (typeof sourceCatalogActions)[number];

export type SourceCatalogEntry = {
  id: SourceCatalogId;
  name: string;
  availability: SourceAvailabilityState;
  action: SourceCatalogAction;
  summary: string;
};

export type SourceCatalogInput = {
  receiptInboxPubliclyAvailable: boolean;
  receiptInboxState: string | null;
  gmailOauthReady?: boolean;
};

function billingInboxEntry(input: SourceCatalogInput): SourceCatalogEntry {
  if (!input.receiptInboxPubliclyAvailable) {
    return {
      id: "BILLING_INBOX",
      name: "Private billing inbox",
      availability: "UNAVAILABLE",
      action: "NONE",
      summary: "Receipt forwarding is not available on this deployment yet. You can still paste or upload billing evidence. Vognary does not read your mailbox.",
    };
  }
  const ready = input.receiptInboxState === "READY" || input.receiptInboxState === "RECEIVED" || input.receiptInboxState === "PROCESSING";
  if (ready) {
    return {
      id: "BILLING_INBOX",
      name: "Private billing inbox",
      availability: "CONNECTED",
      action: "MANAGE",
      summary: "Matching billing mail sent to your private address becomes receipt evidence. Vognary does not read the mailbox.",
    };
  }
  if (input.receiptInboxState === "UNAVAILABLE") {
    return {
      id: "BILLING_INBOX",
      name: "Private billing inbox",
      availability: "UNAVAILABLE",
      action: "NONE",
      summary: "Receipt forwarding is not active yet. Use manual evidence. Vognary does not read your mailbox.",
    };
  }
  return {
    id: "BILLING_INBOX",
    name: "Private billing inbox",
    availability: "SETUP",
    action: "SETUP",
    summary: "Create a private address and set up one billing-only forwarding rule. Vognary does not read the mailbox.",
  };
}

function googleWorkspaceEntry(gmailOauthReady: boolean): SourceCatalogEntry {
  return {
    id: "GOOGLE_WORKSPACE",
    name: "Google Workspace",
    availability: "PLANNED",
    action: "NONE",
    summary: gmailOauthReady
      ? "Direct Gmail reading is reserved until a Recovery-native mailbox connector is proven. Billing forwarding is the live path. Vognary does not read Gmail today."
      : "Direct mailbox access needs Google restricted-scope verification and a third-party security assessment. Billing forwarding is the live path. Vognary does not read Gmail today.",
  };
}

export function buildSourceCatalog(input: SourceCatalogInput): readonly SourceCatalogEntry[] {
  const gmailOauthReady = input.gmailOauthReady ?? isRecoveryGmailOauthReady();
  return [
    billingInboxEntry(input),
    googleWorkspaceEntry(gmailOauthReady),
    {
      id: "MICROSOFT_365",
      name: "Microsoft 365",
      availability: "PLANNED",
      action: "NONE",
      summary: "Outlook is not connected. You can forward matching billing mail with an inbox rule. Vognary does not read Outlook.",
    },
    {
      id: "ZOHO_BOOKS",
      name: "Zoho Books",
      availability: "PLANNED",
      action: "NONE",
      summary: "Accounting connectors are not built. Do not treat this as a live integration.",
    },
  ];
}

export function sourceCatalogHasConnectAction(entries: readonly SourceCatalogEntry[]) {
  return entries.some((entry) => entry.action !== "NONE" && entry.availability === "LIVE");
}

export const sourceAvailabilityLabels: Record<SourceAvailabilityState, string> = {
  LIVE: "Available",
  SETUP: "Needs setup",
  CONNECTED: "Connected",
  PLANNED: "Planned",
  UNAVAILABLE: "Not available yet",
};
