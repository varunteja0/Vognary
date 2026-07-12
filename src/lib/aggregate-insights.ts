export const aggregateInsightMinimumWorkspaces = 25;
export const aggregateInsightMaxCommitmentsPerWorkspace = 10;

export type AggregateInsightRow = {
  category: string;
  currency: string;
  frequency: string;
  workspaceCount: number;
  commitmentCount: number;
  medianMonthlyCost: number;
  averageMonthlyCost: number;
  asOfDate: string;
};

/**
 * Fail closed on small cohorts and unexpected dimensions. Merchant labels,
 * workspace ids, user ids, exact dates, evidence, and free text are not part
 * of this contract.
 */
export function normalizeAggregateInsight(row: AggregateInsightRow) {
  if (!Number.isInteger(row.workspaceCount) || row.workspaceCount < aggregateInsightMinimumWorkspaces) return null;
  if (!Number.isInteger(row.commitmentCount) || row.commitmentCount < row.workspaceCount) return null;
  const category = normalizeDimension(row.category, 100);
  const currency = row.currency.trim().toUpperCase();
  const frequency = normalizeDimension(row.frequency, 30);
  if (!category || !/^[A-Z]{3}$/.test(currency) || !frequency || !/^\d{4}-\d{2}-\d{2}$/.test(row.asOfDate)) return null;
  if (![row.medianMonthlyCost, row.averageMonthlyCost].every((value) => Number.isFinite(value) && value >= 0)) return null;
  const workspaceCount = Math.floor(row.workspaceCount / 5) * 5;
  return {
    category,
    currency,
    frequency,
    workspaceCount,
    commitmentCount: Math.max(workspaceCount, Math.floor(row.commitmentCount / 10) * 10),
    medianMonthlyCost: roundPublishedMoney(row.medianMonthlyCost, currency),
    averageMonthlyCost: roundPublishedMoney(row.averageMonthlyCost, currency),
    asOfDate: row.asOfDate,
  };
}

function normalizeDimension(value: string, maxLength: number) {
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function roundPublishedMoney(value: number, currency: string) {
  const increment = currency === "INR" ? 100 : 5;
  return Math.round(value / increment) * increment;
}
