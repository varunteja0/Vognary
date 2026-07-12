export const connectorReauthorizationRequiredCode = "connector_reauthorization_required" as const;

const defaultReauthorizationMessage =
  "The provider authorization has expired or was revoked. Reconnect this source to resume automatic sync.";

/**
 * A non-retryable connector failure that requires a fresh user authorization.
 *
 * Provider response bodies are deliberately excluded so this error is safe to
 * persist in sync status and return to an authenticated client.
 */
export class ConnectorReauthorizationRequiredError extends Error {
  readonly code = connectorReauthorizationRequiredCode;
  readonly retryable = false;

  constructor(
    readonly provider: string,
    message = defaultReauthorizationMessage,
  ) {
    super(message);
    this.name = "ConnectorReauthorizationRequiredError";
  }
}

export function isConnectorReauthorizationRequiredError(
  error: unknown,
): error is ConnectorReauthorizationRequiredError {
  return error instanceof ConnectorReauthorizationRequiredError
    || (
      error instanceof Error
      && "code" in error
      && error.code === connectorReauthorizationRequiredCode
    );
}
