export type SourceHealthLike = {
  connectorId: string;
  displayName?: string | null;
  status: string;
  freshnessStatus: "unknown" | "fresh" | "stale" | "error" | null;
  latestRunStatus?: string | null;
};

export function sourceNeedsAttention(source: SourceHealthLike): boolean {
  return source.status === "error"
    || source.status === "needs_reauth"
    || source.freshnessStatus === "stale"
    || source.freshnessStatus === "error"
    || source.latestRunStatus === "failed"
    || source.latestRunStatus === "blocked";
}

export function sourceHealthPresentation(source: SourceHealthLike): { label: string; className: string } {
  if (source.status === "needs_reauth") return { label: "Reconnect", className: "pill pill-blocked" };
  if (source.status === "error" || source.freshnessStatus === "error" || source.latestRunStatus === "failed" || source.latestRunStatus === "blocked") {
    return { label: "Sync issue", className: "pill pill-blocked" };
  }
  if (source.freshnessStatus === "fresh") return { label: "Fresh", className: "pill pill-ready" };
  if (source.freshnessStatus === "stale") return { label: "Needs refresh", className: "pill pill-partial" };
  return { label: "Awaiting sync", className: "pill pill-planned" };
}

export function sourceDisplayName(source: Pick<SourceHealthLike, "connectorId" | "displayName">): string {
  if (source.displayName?.trim()) return source.displayName.trim();
  if (source.connectorId === "gmail-readonly") return "Gmail receipts";
  if (source.connectorId === "account-aggregator") return "Account Aggregator";
  if (source.connectorId === "openai-costs") return "OpenAI usage";
  return source.connectorId
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}