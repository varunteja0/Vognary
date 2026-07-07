import type { ConnectorAdapter, ConnectorConnection } from "@/lib/connector-runtime";
import { gmailReadonlyAdapter } from "@/lib/connectors/gmail-readonly-adapter";
import { openAiCostsAdapter } from "@/lib/connectors/openai-costs-adapter";
import { cloudflareBillingAdapter, githubCopilotAdapter, renderPlatformAdapter, vercelPlatformAdapter } from "@/lib/connectors/platform-api-adapters";

const adapters = new Map<string, ConnectorAdapter>([
  [gmailReadonlyAdapter.id, gmailReadonlyAdapter],
  [openAiCostsAdapter.id, openAiCostsAdapter],
  [githubCopilotAdapter.id, githubCopilotAdapter],
  [cloudflareBillingAdapter.id, cloudflareBillingAdapter],
  [renderPlatformAdapter.id, renderPlatformAdapter],
  [vercelPlatformAdapter.id, vercelPlatformAdapter],
]);

export function getConnectorAdapter(connectorId: string) {
  return adapters.get(connectorId) ?? null;
}

export function listConnectorAdapters() {
  return Array.from(adapters.keys());
}

export function buildEnvironmentConnection(connectorId: string, workspaceId = "env-preview"): ConnectorConnection {
  return {
    connectorId,
    workspaceId,
    scopes: [],
  };
}