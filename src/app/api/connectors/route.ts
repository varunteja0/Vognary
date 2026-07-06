import { NextResponse } from "next/server";
import { connectors, getConnectorSummary, getConnectorSyncSummary } from "@/lib/connectors";
import { listConnectorAdapters } from "@/lib/connectors/adapter-registry";
import { buildConnectorReadiness } from "@/lib/connector-runtime";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    status: "ok",
    summary: getConnectorSummary(),
    syncSummary: getConnectorSyncSummary(),
    readiness: buildConnectorReadiness(),
    adapters: listConnectorAdapters(),
    connectors,
  });
}