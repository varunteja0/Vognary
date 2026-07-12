import "server-only";

import {
  revokeConnectorCredentialAtProviderWithDependencies,
  type ProviderRevocationOutcome,
} from "@/lib/connector-provider-revocation";
import { loadConnectorSecret } from "@/lib/server/connector-token-store";

export type { ProviderRevocationOutcome } from "@/lib/connector-provider-revocation";

/** Best-effort remote revocation. Callers must still erase local credentials. */
export async function revokeConnectorCredentialAtProvider(
  input: { connectedAccountId: string; connectorId: string },
): Promise<ProviderRevocationOutcome> {
  return revokeConnectorCredentialAtProviderWithDependencies(input, {
    fetchImpl: fetch,
    loadSecret: loadConnectorSecret,
  });
}
