import type { ConnectorAdapter, ConnectorConnection } from "@/lib/connector-runtime";
import { openAiCostsAdapter } from "@/lib/connectors/openai-costs-adapter";

const adapters = new Map<string, ConnectorAdapter>([
  [openAiCostsAdapter.id, openAiCostsAdapter],
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