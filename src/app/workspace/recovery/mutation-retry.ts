import type { MutationContext, TransportFailure } from "./transport";

export function createMutationRetryTracker(createKey: () => string) {
  const attempts = new Map<string, { signature: string; context: MutationContext }>();
  return {
    context(workspaceId: string, operation: string, request: unknown, workspaceVersion: number): MutationContext {
      const slot = JSON.stringify([workspaceId, operation]);
      const signature = JSON.stringify(request);
      const previous = attempts.get(slot);
      if (previous?.signature === signature) return previous.context;
      const context = { workspaceId, workspaceVersion, idempotencyKey: createKey() };
      attempts.set(slot, { signature, context });
      return context;
    },
    settle(context: MutationContext, result: { ok: true } | TransportFailure) {
      if (!result.ok && result.outcome === "UNKNOWN") return;
      for (const [slot, attempt] of attempts) {
        if (attempt.context.idempotencyKey === context.idempotencyKey) attempts.delete(slot);
      }
    },
  };
}
