export type ConnectorPreviewEnvironment = {
  NODE_ENV?: string;
  ENABLE_ENV_CONNECTOR_PREVIEW?: string;
};

/** Environment-backed credentials are operator diagnostics, never a tenant API. */
export function isEnvironmentConnectorPreviewEnabled(
  environment: ConnectorPreviewEnvironment = process.env,
) {
  return environment.NODE_ENV !== "production" && environment.ENABLE_ENV_CONNECTOR_PREVIEW === "true";
}
