import { legacyConnectorRetiredResponse } from "@/lib/legacy-connector-retirement";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ConnectorRouteContext = { params: Promise<{ id: string }> };

export function POST(_request: Request, _context: ConnectorRouteContext) {
  void _request;
  void _context;
  return legacyConnectorRetiredResponse();
}
