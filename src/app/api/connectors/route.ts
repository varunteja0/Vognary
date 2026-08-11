import { legacyConnectorRetiredResponse } from "@/lib/legacy-connector-retirement";

export const dynamic = "force-dynamic";

export function GET() {
  return legacyConnectorRetiredResponse();
}