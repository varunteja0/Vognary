import { getConnectorById } from "@/lib/connectors";

export type ProviderRevocationStatus =
  | "revoked"
  | "not_confirmed"
  | "unreachable"
  | "credential_unavailable"
  | "manual_action_required"
  | "not_supported";

export type ProviderRevocationOutcome = {
  provider: string;
  status: ProviderRevocationStatus;
  attempted: boolean;
  remoteCredentialMayRemainActive: boolean;
  message: string;
};

export type ProviderRevocationDependencies = {
  fetchImpl: typeof fetch;
  loadSecret: (connectedAccountId: string, tokenKind: "refresh" | "access") => Promise<string | null>;
};

const googleRevocationEndpoint = "https://oauth2.googleapis.com/revoke";
const providerRevocationTimeoutMs = 12_000;

/** Pure provider-revocation policy with injected secret access and transport. */
export async function revokeConnectorCredentialAtProviderWithDependencies(
  input: { connectedAccountId: string; connectorId: string },
  dependencies: ProviderRevocationDependencies,
): Promise<ProviderRevocationOutcome> {
  const connector = getConnectorById(input.connectorId);

  if (connector?.authType === "api-key") {
    return {
      provider: input.connectorId,
      status: "manual_action_required",
      attempted: false,
      remoteCredentialMayRemainActive: true,
      message: "Vognary cannot revoke a provider API key remotely. Revoke or rotate it in the provider dashboard.",
    };
  }

  if (input.connectorId !== "gmail-readonly") {
    return {
      provider: input.connectorId,
      status: "not_supported",
      attempted: false,
      remoteCredentialMayRemainActive: true,
      message: "Provider-side revocation is not supported for this connector. Review the provider account after disconnecting.",
    };
  }

  let token: string | null;
  try {
    token = await dependencies.loadSecret(input.connectedAccountId, "refresh")
      ?? await dependencies.loadSecret(input.connectedAccountId, "access");
  } catch {
    return {
      provider: "google",
      status: "credential_unavailable",
      attempted: false,
      remoteCredentialMayRemainActive: true,
      message: "The local Google credential could not be read, so provider revocation could not be confirmed.",
    };
  }

  if (!token) {
    return {
      provider: "google",
      status: "credential_unavailable",
      attempted: false,
      remoteCredentialMayRemainActive: true,
      message: "No local Google credential was available, so provider revocation could not be confirmed.",
    };
  }

  try {
    const response = await dependencies.fetchImpl(googleRevocationEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(providerRevocationTimeoutMs),
    });

    if (response.ok) {
      return {
        provider: "google",
        status: "revoked",
        attempted: true,
        remoteCredentialMayRemainActive: false,
        message: "Google confirmed provider-side credential revocation.",
      };
    }

    return {
      provider: "google",
      status: "not_confirmed",
      attempted: true,
      remoteCredentialMayRemainActive: true,
      message: `Google did not confirm credential revocation (HTTP ${response.status}).`,
    };
  } catch {
    return {
      provider: "google",
      status: "unreachable",
      attempted: true,
      remoteCredentialMayRemainActive: true,
      message: "Google could not be reached before the revocation timeout.",
    };
  }
}
