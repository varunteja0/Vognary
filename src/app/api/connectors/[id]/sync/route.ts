import { legacyConnectorRetiredResponse } from "@/lib/legacy-connector-retirement";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";

export const dynamic = "force-dynamic";

type ConnectorRouteContext = { params: Promise<{ id: string }> };

export function GET(_request: Request, _context: ConnectorRouteContext) {
  void _request;
  void _context;
  return legacyConnectorRetiredResponse();
}

export async function POST(request: Request, _context: ConnectorRouteContext) {
  void _context;
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  return legacyConnectorRetiredResponse();
}
