import { legacyConnectorRetiredResponse } from "@/lib/legacy-connector-retirement";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return legacyConnectorRetiredResponse();
}

export async function POST(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  return legacyConnectorRetiredResponse();
}
