import "server-only";

import { after } from "next/server";

import { deliverControlAttentionNotifications } from "@/lib/server/commitment-control-attention-delivery";
import { scheduleControlAttentionNotifications } from "@/lib/server/commitment-control-attention-store";
import { reportServerError } from "@/lib/server/monitoring";

export type ControlAttentionProjectionStatus = "scheduled" | "pending-worker-retry";

type ControlAttentionRefreshDependencies = {
  schedule?: typeof scheduleControlAttentionNotifications;
  reportFailure?: typeof reportAttentionFailure;
};

export async function refreshControlAttentionAfterMutation(input: {
  workspaceId: string;
  requestId: string;
  routePath: string;
}, dependencies: ControlAttentionRefreshDependencies = {}): Promise<ControlAttentionProjectionStatus> {
  const now = new Date();
  const schedule = dependencies.schedule ?? scheduleControlAttentionNotifications;
  const reportFailure = dependencies.reportFailure ?? reportAttentionFailure;
  try {
    await schedule({ workspaceIds: [input.workspaceId], now });
  } catch (error) {
    await reportFailure(error, input.routePath, input.requestId, "schedule").catch(() => undefined);
    return "pending-worker-retry";
  }

  if (process.env.NODE_ENV === "test") return "scheduled";
  after(async () => {
    try {
      await deliverControlAttentionNotifications({
        workspaceIds: [input.workspaceId],
        now: new Date(),
        lockOwner: `control-write-${input.requestId}`,
      });
    } catch (error) {
      await reportAttentionFailure(error, input.routePath, input.requestId, "deliver");
    }
  });
  return "scheduled";
}

function reportAttentionFailure(error: unknown, routePath: string, requestId: string, stage: "schedule" | "deliver") {
  return reportServerError(error, { path: routePath, method: "POST", headers: {} }, {
    feature: "commitment-control-attention",
    requestId,
    stage,
  });
}