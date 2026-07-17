import {
  connectors,
  getConnectorById,
  getConnectorHonestyState,
  connectorHonestyStateLabels,
  connectorHonestyStateMeanings,
  type Connector,
  type ConnectorHonestyState,
  type ConnectorStatus,
} from "@/lib/connectors";

export type ConnectorStartState = "ready-to-connect" | "needs-configuration" | "adapter-planned" | "partner-gated" | "manual-evidence" | "unknown-connector";
export type ConnectorSyncState = "ready" | "blocked" | "manual" | "not-found";

export type ConnectorConnection = {
  connectorId: string;
  workspaceId: string;
  connectedAccountId?: string;
  providerAccountId?: string;
  accessRef?: string;
  refreshRef?: string;
  accessToken?: string;
  refreshToken?: string;
  apiKey?: string;
  expiresAt?: string;
  scopes: string[];
};

export type ConnectorEvidence = {
  connectorId: string;
  /** Stable provider-side identity. It must not change when mutable fields (for
   * example amount or status) are corrected on a later sync. */
  externalId: string;
  provider: string;
  observedAt: string;
  evidenceType: Connector["dataTypes"][number];
  merchantRaw?: string;
  amount?: number;
  currency?: string;
  category?: string;
  cadenceHint?: string;
  nextDebitHint?: string;
  sourcePayloadHash?: string;
  confidence: number;
};

export type ConnectorCoverageWindow = {
  startAt?: string;
  endAt: string;
  completeness: "partial" | "complete";
};

export type ConnectorSyncResult = {
  evidence: ConnectorEvidence[];
  nextCursorState?: Record<string, unknown>;
  nextSyncAt?: string;
  coverage?: ConnectorCoverageWindow;
  /** True when the adapter intentionally returned a bounded page and the same
   * job must be queued promptly to finish the provider window. */
  continuation?: boolean;
  /** Provider authorization state observed during this sync. A pending batch
   * is never materialized as evidence and must not make a source look active. */
  activationState?: "pending" | "active";
};

export type ConnectorSyncContext = {
  cursorState: Record<string, unknown>;
  startedAt: string;
};

export type ConnectorSyncPlan = {
  connectorId: string;
  state: ConnectorSyncState;
  mode: Connector["syncMode"];
  trustClass: Connector["trustClass"];
  dataTypes: Connector["dataTypes"];
  steps: string[];
  blockers: string[];
};

export type ConnectorAdapter = {
  id: string;
  connect(connection: ConnectorConnection): Promise<ConnectorConnection>;
  sync(connection: ConnectorConnection, context?: ConnectorSyncContext): Promise<ConnectorEvidence[] | ConnectorSyncResult>;
};

const configuredEnv = (connector: Connector) => {
  if (connector.id === "gmail-readonly") {
    return [
      process.env.GOOGLE_CLIENT_ID ? "GOOGLE_CLIENT_ID" : process.env.GOOGLE_AUTH_CLIENT_ID ? "GOOGLE_AUTH_CLIENT_ID" : null,
      process.env.GOOGLE_CLIENT_SECRET ? "GOOGLE_CLIENT_SECRET" : process.env.GOOGLE_AUTH_CLIENT_SECRET ? "GOOGLE_AUTH_CLIENT_SECRET" : null,
      process.env.GOOGLE_REDIRECT_URI ? "GOOGLE_REDIRECT_URI" : null,
    ].filter((value): value is string => Boolean(value));
  }

  return connector.envVars?.filter((envVar) => Boolean(process.env[envVar])) ?? [];
};

const missingEnv = (connector: Connector) => {
  if (connector.id === "gmail-readonly") {
    return [
      process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_AUTH_CLIENT_ID ? null : "GOOGLE_CLIENT_ID or GOOGLE_AUTH_CLIENT_ID",
      process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_AUTH_CLIENT_SECRET ? null : "GOOGLE_CLIENT_SECRET or GOOGLE_AUTH_CLIENT_SECRET",
      process.env.NODE_ENV !== "production" || process.env.GOOGLE_REDIRECT_URI ? null : "GOOGLE_REDIRECT_URI",
    ].filter((value): value is string => Boolean(value));
  }

  return connector.envVars?.filter((envVar) => !process.env[envVar]) ?? [];
};

export function getConnectorStartState(connector: Connector | undefined): ConnectorStartState {
  if (!connector) return "unknown-connector";
  if (connector.status === "partner-required") return "partner-gated";
  if (connector.status === "planned") return "adapter-planned";
  if (connector.authType === "manual" || connector.authType === "file-fallback") return "manual-evidence";
  if (connector.status === "ready-with-env" && !connector.envVars?.length) return "needs-configuration";
  if (missingEnv(connector).length > 0) return "needs-configuration";
  return "ready-to-connect";
}

export function getConnectorSyncState(connector: Connector | undefined): ConnectorSyncState {
  if (!connector) return "not-found";
  if (connector.authType === "manual" || connector.authType === "file-fallback") return "manual";
  if (connector.status === "partner-required" || connector.status === "planned") return "blocked";
  if (missingEnv(connector).length > 0) return "blocked";
  return "ready";
}

export function buildConnectorStartResponse(connectorId: string) {
  const connector = getConnectorById(connectorId);
  const state = getConnectorStartState(connector);

  if (!connector) {
    return {
      status: "error" as const,
      state,
      message: "Connector was not found in the Vognary registry.",
    };
  }

  return {
    status: state === "ready-to-connect" ? "ok" as const : "action-required" as const,
    state,
    connector,
    configuredEnv: configuredEnv(connector),
    missingEnv: missingEnv(connector),
    nextSteps: buildStartSteps(connector, state),
  };
}

export function buildConnectorSyncPlan(connectorId: string): ConnectorSyncPlan {
  const connector = getConnectorById(connectorId);

  if (!connector) {
    return {
      connectorId,
      state: "not-found",
      mode: "manual",
      trustClass: "fallback-evidence",
      dataTypes: ["evidence"],
      steps: [],
      blockers: ["Connector was not found in the Vognary registry."],
    };
  }

  const state = getConnectorSyncState(connector);

  return {
    connectorId: connector.id,
    state,
    mode: connector.syncMode,
    trustClass: connector.trustClass,
    dataTypes: connector.dataTypes,
    steps: buildSyncSteps(connector),
    blockers: buildSyncBlockers(connector, state),
  };
}

export function buildConnectorReadiness() {
  const statuses: ConnectorStatus[] = ["live", "ready-with-env", "partner-required", "planned"];

  return statuses.map((status) => ({
    status,
    meaning: getStatusMeaning(status),
  }));
}

// Environment-aware honesty state for one connector in this deployment.
export function getConnectorHonesty(connector: Connector): { state: ConnectorHonestyState; label: string; meaning: string } {
  const state = getConnectorHonestyState(connector, {
    envConfigured: (connector.envVars?.length ?? 0) > 0 && missingEnv(connector).length === 0,
    verificationComplete: connector.id === "gmail-readonly"
      ? process.env.GOOGLE_OAUTH_VERIFICATION_COMPLETE === "true"
      : undefined,
  });

  return {
    state,
    label: connectorHonestyStateLabels[state],
    meaning: connectorHonestyStateMeanings[state],
  };
}

export function buildConnectorHonestyMap() {
  return connectors.map((connector) => ({
    id: connector.id,
    name: connector.name,
    ...getConnectorHonesty(connector),
  }));
}

function buildStartSteps(connector: Connector, state: ConnectorStartState) {
  if (state === "partner-gated") {
    return [
      "Collect provider, issuer, or regulated partner access requirements.",
      "Complete legal and security review before enabling token exchange.",
      "Implement provider-specific webhook and reconciliation jobs after partner approval.",
    ];
  }

  if (state === "manual-evidence") {
    return [
      "Collect user-confirmed evidence from the source dashboard or receipt.",
      "Normalize it into connector evidence.",
      "Merge it into the recurring money graph with lower confidence than direct APIs.",
    ];
  }

  if (state === "needs-configuration") {
    return [
      "Create the provider app or API credential.",
      `Set missing environment variables: ${missingEnv(connector).join(", ")}.`,
      "Run the connector start endpoint again and verify ready-to-connect state.",
    ];
  }

  if (state === "adapter-planned") {
    return [
      "Keep the connector in the registry as a target contract.",
      "Implement the provider adapter, token mapper, and evidence normalizer before enabling user connection.",
      "Expose the connector only after a sandbox credential proves the first sync path.",
    ];
  }

  return [
    "Redirect the user through the provider consent flow or collect the scoped API key.",
    "Store token references in the encrypted token vault.",
    "Queue an initial sync job and return the first evidence batch.",
  ];
}

function buildSyncSteps(connector: Connector) {
  return [
    `Authorize via ${connector.authType}.`,
    `Sync by ${connector.syncMode} into raw evidence records.`,
    `Normalize ${connector.dataTypes.join(", ")} into the recurring money graph.`,
    "Update confidence, coverage, recommendations, and action-center status.",
  ];
}

function buildSyncBlockers(connector: Connector, state: ConnectorSyncState) {
  if (state === "ready" || state === "manual") return [];

  const blockers = [...missingEnv(connector).map((envVar) => `Missing ${envVar}.`)];

  if (connector.status === "partner-required") {
    blockers.push("Provider or regulated partner access is required.");
  }

  if (connector.status === "planned") {
    blockers.push("Provider adapter has not been implemented yet.");
  }

  if (connector.limitation) blockers.push(connector.limitation);

  return blockers;
}

function getStatusMeaning(status: ConnectorStatus) {
  switch (status) {
    case "live":
      return "The product can collect this evidence now, either directly or through a verified fallback.";
    case "ready-with-env":
      return "The code path exists, but provider credentials or OAuth verification are required.";
    case "partner-required":
      return "Direct sync needs a bank, issuer, PSP, network, or regulated partner.";
    case "planned":
      return "The source is in the registry and has a target contract, but the adapter is not live yet.";
  }
}
