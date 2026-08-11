import { legacyConnectorRetiredResponse } from "@/lib/legacy-connector-retirement";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return legacyConnectorRetiredResponse();
}
