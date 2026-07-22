import { NextResponse } from "next/server";
import { isAiEnabled } from "@/lib/server/ai/client";
import { readAiBudgetFromEnv, isAiBudgetOpen } from "@/lib/server/ai/budget-env";
import { AI_MODELS } from "@/lib/server/ai/models";

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
      keyConfigured: keyPresent,
      budgetConfigured: budget.cap > 0,
      models: AI_MODELS,
      policy: "cite-or-shut-up",
      message: live
        ? "AI assist is live for extraction and narration under the monthly cap; every claim must cite evidence."
        : "Product runs deterministic-only until ANTHROPIC_API_KEY and AI_MONTHLY_BUDGET_INR are set.",
    },
    { headers: { "cache-control": "no-store" } },
  );
}
