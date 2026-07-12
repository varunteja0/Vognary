export const productEventNames = [
  "connector.sync.started",
  "connector.sync.succeeded",
  "connector.sync.failed",
  "ledger.materialized",
  "workspace.activated",
  "ledger.viewed",
  "review.action_recorded",
  "review.completed",
  "export.created",
  "private_audit.requested",
  "billing.checkout_started",
  "billing.payment_settled",
  "billing.payment_refunded",
] as const;

export const productEventSources = ["sync-runner", "living-ledger", "workspace-api", "product-ui"] as const;
export const productEventStatuses = ["started", "succeeded", "failed", "partial"] as const;
export const productEventMetricNames = [
  "recordsSeen",
  "evidenceWritten",
  "transactionsWritten",
  "commitmentsTouched",
  "usageObservationsWritten",
] as const;

export type ProductEventName = typeof productEventNames[number];
export type ProductEventSource = typeof productEventSources[number];
export type ProductEventStatus = typeof productEventStatuses[number];
export type ProductEventMetricName = typeof productEventMetricNames[number];

export type ProductEventInput = {
  workspaceId?: string | null;
  userId?: string | null;
  eventName: ProductEventName;
  occurredAt?: string;
  source: ProductEventSource;
  status?: ProductEventStatus | null;
  durationMs?: number | null;
  metrics?: Partial<Record<ProductEventMetricName, number>>;
};

export type NormalizedProductEvent = {
  workspaceId: string | null;
  userId: string | null;
  eventName: ProductEventName;
  occurredAt: string;
  source: ProductEventSource;
  status: ProductEventStatus | null;
  durationMs: number | null;
  metrics: Partial<Record<ProductEventMetricName, number>>;
};

const allowedInputKeys = new Set([
  "workspaceId",
  "userId",
  "eventName",
  "occurredAt",
  "source",
  "status",
  "durationMs",
  "metrics",
]);

export function normalizeProductEvent(input: ProductEventInput): NormalizedProductEvent {
  for (const key of Object.keys(input)) {
    if (!allowedInputKeys.has(key)) throw new Error(`Product event field ${key} is not privacy-safe.`);
  }
  if (!productEventNames.includes(input.eventName)) throw new Error("Product event name is not allowlisted.");
  if (!productEventSources.includes(input.source)) throw new Error("Product event source is not allowlisted.");
  if (input.status && !productEventStatuses.includes(input.status)) throw new Error("Product event status is not allowlisted.");

  const occurredAt = input.occurredAt ?? new Date().toISOString();
  if (Number.isNaN(new Date(occurredAt).getTime())) throw new Error("Product event timestamp is invalid.");

  const durationMs = input.durationMs ?? null;
  if (durationMs !== null && (!Number.isInteger(durationMs) || durationMs < 0 || durationMs > 86_400_000)) {
    throw new Error("Product event duration must be a non-negative integer no greater than one day.");
  }

  const metrics: Partial<Record<ProductEventMetricName, number>> = {};
  for (const [key, value] of Object.entries(input.metrics ?? {})) {
    if (!productEventMetricNames.includes(key as ProductEventMetricName)) {
      throw new Error(`Product event metric ${key} is not allowlisted.`);
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000_000) {
      throw new Error(`Product event metric ${key} must be a bounded non-negative number.`);
    }
    metrics[key as ProductEventMetricName] = value;
  }

  return {
    workspaceId: normalizeUuid(input.workspaceId, "workspace"),
    userId: normalizeUuid(input.userId, "user"),
    eventName: input.eventName,
    occurredAt: new Date(occurredAt).toISOString(),
    source: input.source,
    status: input.status ?? null,
    durationMs,
    metrics,
  };
}

function normalizeUuid(value: string | null | undefined, label: string) {
  if (!value) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`Product event ${label} id must be a UUID.`);
  }
  return value.toLowerCase();
}
