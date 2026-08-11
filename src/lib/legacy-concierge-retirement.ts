export const legacyConciergeRetirementPayload = {
  status: "retired",
  ledgerAuthority: "RECOVERY_V1",
  message: "Provider-executed actions and verified-savings cases are not part of the Recovery launch.",
  replacement: "/api/workspaces/current/decisions",
} as const;

export function legacyConciergeRetiredResponse() {
  return Response.json(legacyConciergeRetirementPayload, {
    status: 410,
    headers: { "cache-control": "no-store" },
  });
}