import { NextResponse } from "next/server";
import { connectors, getConnectorSummary } from "@/lib/connectors";

export function GET() {
  return NextResponse.json({
    status: "ok",
    summary: getConnectorSummary(),
    connectors,
  });
}