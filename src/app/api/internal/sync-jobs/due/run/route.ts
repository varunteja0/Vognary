import { legacyConnectorRetiredResponse } from "@/lib/legacy-connector-retirement";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(_request: Request) {
  void _request;
  return legacyConnectorRetiredResponse();
}

export function POST(_request: Request) {
  void _request;
  return legacyConnectorRetiredResponse();
}
