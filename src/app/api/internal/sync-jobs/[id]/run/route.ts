import { legacyConnectorRetiredResponse } from "@/lib/legacy-connector-retirement";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type InternalSyncJobRunContext = { params: Promise<{ id: string }> };

export function POST(_request: Request, _context: InternalSyncJobRunContext) {
  void _request;
  void _context;
  return legacyConnectorRetiredResponse();
}