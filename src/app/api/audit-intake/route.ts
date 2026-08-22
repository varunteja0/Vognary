import type { NextRequest } from "next/server";
import { assistedAuditRetiredResponse } from "@/lib/assisted-audit-retirement";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";

export const dynamic = "force-dynamic";

export async function GET() {
  return assistedAuditRetiredResponse();
}

export async function POST(request: NextRequest) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  return assistedAuditRetiredResponse();
}
