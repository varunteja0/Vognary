import { NextRequest, NextResponse } from "next/server";
import { analyzeStatements, type ManualRecurringInput, type StatementSource } from "@/lib/recurring-audit";

const maxSourceCount = 8;
const maxSourceCharacters = 1_000_000;

type AuditRequestBody = {
  sources?: StatementSource[];
  manualItems?: ManualRecurringInput[];
};

export async function POST(request: NextRequest) {
  let body: AuditRequestBody;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const sources = Array.isArray(body.sources) ? body.sources : [];
  const manualItems = Array.isArray(body.manualItems) ? body.manualItems : [];

  if (sources.length > maxSourceCount) {
    return NextResponse.json({ error: `Maximum ${maxSourceCount} sources are allowed per audit request.` }, { status: 413 });
  }

  const invalidSource = sources.find((source) => !source?.name || !source?.text || source.text.length > maxSourceCharacters);
  if (invalidSource) {
    return NextResponse.json({ error: "Each source needs a name, statement text, and must stay under the request size limit." }, { status: 400 });
  }

  const audit = analyzeStatements(sources, manualItems);

  return NextResponse.json({
    mode: "stateless-audit-api",
    storage: "none",
    audit,
  });
}