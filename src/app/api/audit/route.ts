import { NextRequest, NextResponse } from "next/server";
import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { indiaCalendarDate, parseIsoDateOnly } from "@/lib/date-only";
import { manualsFromReceiptText } from "@/lib/recovery/first-session-receipts";
import { startCardsFromRecurringItems } from "@/lib/recovery/start-cards";
import { buildRenewalTimeline } from "@/lib/renewal-timeline";
import { analyzeStatements, normalizeCurrencyCode, type Frequency, type ManualRecurringInput, type StatementSource } from "@/lib/recurring-audit";
import { readLimitedJson, RequestBodyTooLargeError, UnsupportedContentTypeError } from "@/lib/server/request-body";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";
import { rejectUnclearedFinancialRequest } from "@/lib/server/financial-intake";

export const dynamic = "force-dynamic";

const maxSourceCount = 8;
const maxSourceCharacters = 1_000_000;
const maxManualItems = 200;
const maxReceiptTexts = 20;
const maxReceiptCharacters = 20_000;
const maxAuditBodyBytes = 9 * 1024 * 1024;

const validFrequencies = new Set<Frequency>(["weekly", "biweekly", "semimonthly", "monthly", "bimonthly", "quarterly", "yearly", "irregular"]);

type AuditRequestBody = {
  fixture?: unknown;
  sources?: StatementSource[];
  manualItems?: ManualRecurringInput[];
  receiptTexts?: string[];
};

export async function POST(request: NextRequest) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;

  const limit = await rateLimit(request, { namespace: "audit", limit: 30, windowMs: 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  let body: unknown;

  try {
    body = await readLimitedJson<unknown>(request, maxAuditBodyBytes);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: "Audit request is too large." }, { status: 413 });
    }
    if (error instanceof UnsupportedContentTypeError) {
      return NextResponse.json({ error: "Content-Type must be application/json." }, { status: 415 });
    }
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (!isAuditRequestBody(body)) {
    return NextResponse.json({ error: "Audit input must be an object with arrays for sources, manualItems, and receiptTexts when supplied." }, { status: 400 });
  }

  const sources = body.sources ?? [];
  let manualItems = body.manualItems ?? [];
  const receiptTexts = body.receiptTexts ?? [];

  if (sources.length > maxSourceCount) {
    return NextResponse.json({ error: `Maximum ${maxSourceCount} sources are allowed per audit request.` }, { status: 413 });
  }

  if (sources.some((source) => !source || typeof source !== "object"
    || typeof source.name !== "string" || !source.name.trim()
    || typeof source.text !== "string" || !source.text.trim() || source.text.length > maxSourceCharacters)) {
    return NextResponse.json({ error: "Each source needs a name, statement text, and must stay under the request size limit." }, { status: 400 });
  }

  if (manualItems.length > maxManualItems) {
    return NextResponse.json({ error: `Maximum ${maxManualItems} manual items are allowed per audit request.` }, { status: 413 });
  }

  if (manualItems.some((item) => !isValidManualItem(item))) {
    return NextResponse.json({ error: "Each manual item needs an id, merchant, positive finite amount, valid frequency, and next expected date." }, { status: 400 });
  }

  if (receiptTexts.length > maxReceiptTexts) {
    return NextResponse.json({ error: `Maximum ${maxReceiptTexts} receipt texts are allowed per audit request.` }, { status: 413 });
  }

  if (receiptTexts.some((text) => typeof text !== "string" || text.length > maxReceiptCharacters)) {
    return NextResponse.json({ error: `Each receipt text must be a string under ${maxReceiptCharacters} characters.` }, { status: 400 });
  }

  const today = indiaCalendarDate();
  const fixedDemo = body.fixture === "SUPPLIER_BILL_DEMO_V1" && Object.keys(body).length === 1;
  const suppliedFinancialInput = sources.length > 0 || manualItems.length > 0 || receiptTexts.length > 0;
  if (body.fixture !== undefined && !fixedDemo) {
    return NextResponse.json({ code: "FINANCIAL_INTAKE_LOCKED", error: "The public demonstration accepts only its fixed fixture identifier, without financial input." }, { status: 403 });
  }
  if (suppliedFinancialInput) {
    const blocked = await rejectUnclearedFinancialRequest(request);
    if (blocked) return blocked;
  }
  if (fixedDemo) {
    manualItems = [{ id: "synthetic-supplier-demo", merchant: "Synthetic supplier", amount: 120, currency: "INR", frequency: "monthly", nextExpectedDate: today, category: "Synthetic demonstration" }];
  }
  const receiptItems = receiptTexts.flatMap((text, index) => manualsFromReceiptText(text, `Receipt text ${index + 1}`, today));
  const audit = analyzeStatements(sources, [...manualItems, ...receiptItems]);

  return NextResponse.json({
    mode: fixedDemo ? "fixed-synthetic-demo" : "stateless-audit-api",
    ...(fixedDemo ? { fixture: "SUPPLIER_BILL_DEMO_V1" } : {}),
    storage: "none",
    audit,
    cards: startCardsFromRecurringItems(audit.recurringItems, today),
    timeline: buildRenewalTimeline(audit.recurringItems, { horizonDays: 45 }),
  });
}

function isAuditRequestBody(value: unknown): value is AuditRequestBody {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return ["sources", "manualItems", "receiptTexts"].every((field) => body[field] === undefined || Array.isArray(body[field]));
}

function isValidManualItem(item: ManualRecurringInput | undefined): boolean {
  if (!item || typeof item !== "object") return false;
  return typeof item.id === "string" && item.id.length > 0 && item.id.length <= 200
    && typeof item.merchant === "string" && item.merchant.trim().length > 0 && item.merchant.length <= 200
    && typeof item.amount === "number" && Number.isFinite(item.amount) && item.amount > 0
    && typeof item.frequency === "string" && validFrequencies.has(item.frequency)
    && typeof item.nextExpectedDate === "string" && Boolean(parseIsoDateOnly(item.nextExpectedDate))
    && typeof item.category === "string" && item.category.length <= 100
    && (item.currency === undefined || (typeof item.currency === "string" && normalizeCurrencyCode(item.currency, null) !== null))
    && (item.sourceName === undefined || (typeof item.sourceName === "string" && item.sourceName.length <= 200));
}
