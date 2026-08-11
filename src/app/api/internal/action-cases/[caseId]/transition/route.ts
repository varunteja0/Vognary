import { legacyConciergeRetiredResponse } from "@/lib/legacy-concierge-retirement";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST() {
  return legacyConciergeRetiredResponse();
}
