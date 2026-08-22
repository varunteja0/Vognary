import { NextResponse } from "next/server";
import { isAiEnabled } from "@/lib/server/ai/client";
import { readAiBudgetFromEnv, isAiBudgetOpen } from "@/lib/server/ai/budget-env";

export const dynamic = "force-dynamic";

/**
 * Public, non-secret AI readiness. Never exposes keys or remaining budget
 * amounts — only whether the cite-or-shut-up layer can run.
 */
export async function GET() {
  const budget = readAiBudgetFromEnv();
  const keyPresent = isAiEnabled();
  const budgetOpen = isAiBudgetOpen(budget);
  const live = keyPresent && budgetOpen;

  return NextResponse.json(
    {
      status: live ? "live" : "deterministic-only",
      policy: "cite-or-shut-up",
      message: live
        ? "Optional AI assistance is available; every rendered financial claim must still cite evidence."
        : "Vognary is using its deterministic evidence path. Uncited financial claims are not rendered.",
    },
    { headers: { "cache-control": "no-store" } },
  );
}
