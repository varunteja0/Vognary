export type ProfilePayload = {
  status: "ok";
  session: {
    email: string;
    workspaceId: string | null;
    issuedAt: string;
    expiresAt: string;
  };
  user: null | {
    id: string;
    email: string;
    displayName: string | null;
    createdAt: string;
    updatedAt: string;
  };
  activeWorkspace: null | {
    workspaceId: string;
    workspaceName: string;
    role: string;
    plan: string;
  };
  workspaces: Array<{
    workspaceId: string;
    workspaceName: string;
    role: string;
    plan: string;
  }>;
  data: {
    auditReports: number;
    dataSources: number;
    connectedAccounts: number;
    uploadedFiles: number;
    transactions: number;
    recurringItems: number;
    connectorEvidence: number;
    usageObservations: number;
    latestSnapshotAt: string | null;
    latestSummary: Record<string, unknown> | null;
  };
  integrations: {
    connectedNow: string[];
    pending: string[];
    connectorSummary: Record<string, number>;
    tokenVault: string;
  };
  deleteConfirmation: string;
};

export type ConsentRecord = {
  id: string;
  purpose: string;
  noticeVersion: string;
  source: string;
  scopes: unknown;
  grantedAt: string;
  withdrawnAt: string | null;
  expiresAt: string | null;
  active: boolean;
};

export type PlatformTokenSummary = {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export type RenewalAlertPreference = {
  enabled: boolean;
  weeklyDigestEnabled: boolean;
  sevenDayEnabled: boolean;
  oneDayEnabled: boolean;
  timeZone: string;
  sendHourLocal: number;
  consentActive?: boolean;
  disabledReason?: string | null;
};

export type RetentionPolicy = {
  workspaceId: string;
  rawConnectorPayloadDays: number;
  productEventDays: number;
  operationalErrorDays: number;
  usesWorkspaceOverride: boolean;
  updatedAt: string | null;
};

export type PrivacyRequest = {
  id: string;
  requestType: "access_export";
  status: "ready" | "completed" | "failed" | "expired";
  requestedAt: string;
  downloadExpiresAt: string;
  downloadCount: number;
};

export type ProfileStatusScope = "account" | "notifications" | "privacyConsent" | "privacyData" | "developer" | "danger";

export type ProfileStatuses = Record<ProfileStatusScope, string>;
