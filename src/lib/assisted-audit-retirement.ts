export const assistedAuditRetirementPayload = {
  status: "retired",
  replacement: "/login?next=/app",
  message: "The one-time assisted audit is retired. Add billing evidence in the current Vognary workspace instead.",
} as const;

export function assistedAuditRetiredResponse() {
  return Response.json(assistedAuditRetirementPayload, {
    status: 410,
    headers: {
      "cache-control": "no-store",
      deprecation: "true",
      link: "</login?next=/app>; rel=successor-version",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
