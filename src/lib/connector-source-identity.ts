import type { EvidenceCoverageWindow } from "./verified-savings";

export type ConnectorSourceCoverage = {
  connectedAccountId: string;
  connectorId: string;
  status: string;
  coverageStartAt: string | null;
  coverageEndAt: string | null;
};

export function connectorEvidenceSourceName(connectorId: string, connectedAccountId: string | null) {
  const account = connectedAccountId?.trim() || "unscoped";
  return `${connectorId}-automatic-evidence-${account}.csv`;
}

export function buildConnectorCoverageWindows(
  sources: ConnectorSourceCoverage[],
): EvidenceCoverageWindow[] {
  return sources.flatMap((source) => {
    if (source.status !== "active" || !source.coverageStartAt || !source.coverageEndAt) return [];
    const startDate = isoDate(source.coverageStartAt);
    const endDate = isoDate(source.coverageEndAt);
    if (!startDate || !endDate || startDate > endDate) return [];
    return [{
      source: connectorEvidenceSourceName(source.connectorId, source.connectedAccountId),
      startDate,
      endDate,
    }];
  });
}

function isoDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}