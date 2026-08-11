import { legacyConciergeRetiredResponse } from "@/lib/legacy-concierge-retirement";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return legacyConciergeRetiredResponse();
}

export function PATCH(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  return legacyConciergeRetiredResponse();
}
