import { NextRequest, NextResponse } from "next/server";
import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { indiaCalendarDate, parseIsoDateOnly } from "@/lib/date-only";
import { manualsFromReceiptText } from "@/lib/recovery/first-session-receipts";
import { startCardsFromRecurringItems } from "@/lib/recovery/start-cards";
import { buildRenewalTimeline } from "@/lib/renewal-timeline";
import { analyzeStatements, normalizeCurrencyCode, type Frequency, type ManualRecurringInput, type StatementSource } from "@/lib/recurring-audit";
import { readLimitedJson, RequestBodyTooLargeError, UnsupportedContentTypeError } from "@/lib/server/request-body";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";

export const dynamic = "force-dynamic";

const maxSourceCount = 8;
const maxSourceCharacters = 1_000_000;
const maxManualItems = 200;
const maxReceiptTexts = 20;
const maxReceiptCharacters = 20_000;
const maxAuditBodyBytes = 9 * 1024 * 1024;

const validFrequencies = new Set<Frequency>(["weekly", "biweekly", "semimonthly", "monthly", "bimonthly", "quarterly", "yearly", "irregular"]);

type AuditRequestBody = {
  sources?: StatementSource[];
  manualItems?: ManualRecurringInput[];
  receiptTexts?: string[];
};

export async function POST(request: NextRequest) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;

  const limit = await rateLimit(request, { namespace: "audit", limit: 30, windowMs: 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  let body: AuditRequestBody;

  try {
    body = await readLimitedJson<AuditRequestBody>(request, maxAuditBodyBytes);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: "Audit request is too large." }, { status: 413 });
    }
    if (error instanceof UnsupportedContentTypeError) {
      return NextResponse.json({ error: "Content-Type must be application/json." }, { status: 415 });
    }
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const sources = Array.isArray(body.sources) ? body.sources : [];
  const manualItems = Array.isArray(body.manualItems) ? body.manualItems : [];
  const receiptTexts = Array.isArray(body.receiptTexts) ? body.receiptTexts : [];

  if (sources.length > maxSourceCount) {
    return NextResponse.json({ error: `Maximum ${maxSourceCount} sources are allowed per audit request.` }, { status: 413 });
  }

  const invalidSource = sources.find((source) => !source?.name || !source?.text || source.text.length > maxSourceCharacters);
  if (invalidSource) {
    return NextResponse.json({ error: "Each source needs a name, statement text, and must stay under the request size limit." }, { status: 400 });
  }

  if (manualItems.length > maxManualItems) {
    return NextResponse.json({ error: `Maximum ${maxManualItems} manual items are allowed per audit request.` }, { status: 413 });
  }

  const invalidManualItem = manualItems.find((item) => !isValidManualItem(item));
  if (invalidManualItem) {
    return NextResponse.json({ error: "Each manual item needs an id, merchant, positive finite amount, valid frequency, and next expected date." }, { status: 400 });
  }

  if (receiptTexts.length > maxReceiptTexts) {
    return NextResponse.json({ error: `Maximum ${maxReceiptTexts} receipt texts are allowed per audit request.` }, { status: 413 });
  }

  const invalidReceipt = receiptTexts.find((text) => typeof text !== "string" || text.length > maxReceiptCharacters);
  if (invalidReceipt !== undefined) {
    return NextResponse.json({ error: `Each receipt text must be a string under ${maxReceiptCharacters} characters.` }, { status: 400 });
  }

  const today = indiaCalendarDate();
  const receiptItems = receiptTexts.flatMap((text, index) => manualsFromReceiptText(text, `Receipt text ${index + 1}`, today));
  const audit = analyzeStatements(sources, [...manualItems, ...receiptItems]);

  return NextResponse.json({
    mode: "stateless-audit-api",
    storage: "none",
    audit,
    cards: startCardsFromRecurringItems(audit.recurringItems, today),
    timeline: buildRenewalTimeline(audit.recurringItems, { horizonDays: 45 }),
  });
}

function isValidManualItem(item: ManualRecurringInput | undefined): boolean {
  if (!item || typeof item !== "object") return false;
  return typeof item.id === "string" && item.id.length > 0 && item.id.length <= 200
    && typeof item.merchant === "string" && item.merchant.trim().length > 0 && item.merchant.length <= 200
    && typeof item.amount === "number" && Number.isFinite(item.amount) && item.amount > 0
    && typeof item.frequency === "string" && validFrequencies.has(item.frequency)
    && typeof item.nextExpectedDate === "string" && Boolean(parseIsoDateOnly(item.nextExpectedDate))
    && typeof item.category === "string" && item.category.length <= 100
    && (item.currency === undefined || normalizeCurrencyCode(item.currency, null) !== null)
    && (item.sourceName === undefined || (typeof item.sourceName === "string" && item.sourceName.length <= 200));
}
