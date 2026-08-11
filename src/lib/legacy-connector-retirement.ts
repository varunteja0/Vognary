export const legacyConnectorRetirementPayload = {
  status: "retired",
  ledgerAuthority: "RECOVERY_V1",
  message: "Direct provider connections are not part of the Recovery launch.",
  replacements: {
    forwardedReceipts: "/api/workspaces/current/sources/receipt-inbox",
    manualEvidence: "/api/workspaces/current/evidence",
  },
} as const;

export function legacyConnectorRetiredResponse() {
  return Response.json(legacyConnectorRetirementPayload, {
    status: 410,
    headers: { "cache-control": "no-store" },
  });
}