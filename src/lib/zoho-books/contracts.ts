import { parseIsoDateOnly } from "@/lib/date-only";
import { decimalToMinorUnits } from "@/lib/recovery/domain";
import { isBillDisposition, type BillDisposition } from "./resolution";

export const zohoBooksScopes = ["ZohoBooks.settings.READ", "ZohoBooks.bills.READ"] as const;
export const zohoBooksVersion = 1;
export const zohoBillStates = ["draft", "pending_approval", "approved", "open", "overdue", "partially_paid", "paid", "void"] as const;

export type ZohoBill = {
  version: 1;
  billId: string;
  vendorId: string;
  vendorName: string;
  billNumber: string;
  date: string;
  status: (typeof zohoBillStates)[number];
  currency: string;
  totalMinor: string;
  balanceMinor: string;
  sourceTotal: string;
  sourceBalance: string;
  modifiedAt: string;
  basis: "PROVIDER_BILL_TOTAL";
};

export type ZohoBillChange = "BASELINE" | "NEW" | "AMENDED" | "VOIDED" | "REMOVED";
export type ZohoOrganization = { id: string; name: string; currency: string; active: boolean };

export type ZohoConnectionStatus = "AUTHORIZING" | "AWAITING_ORGANIZATION" | "QUEUED" | "SYNCING" | "READY" | "RETRY_WAIT" | "REAUTH_REQUIRED" | "FAILED" | "REVOKED";
export type ZohoBooksIncident = {
  id: string;
  failureCode: string;
  assignedOperatorUserId: string | null;
  deliveryStatus: "PENDING" | "DELIVERED" | "FAILED" | "UNCONFIGURED";
  createdAt: string;
  deliveredAt: string | null;
  resumedAt: string | null;
  recoveredAt: string | null;
  canResume: boolean;
  canEscalate?: boolean;
};
export type ZohoObservation = { sequence: string; bill: ZohoBill; previous: ZohoBill | null; previousChangeKind?: ZohoBillChange | null; changeKind: ZohoBillChange; observedAt: string; disposition?: BillDisposition | null; openFollowUpCount?: number; followUpOn?: string | null; responsibleUserId?: string | null; reviewRelevance?: "BASELINE" | "INFORMATIONAL" | "MATERIAL"; pendingReviewCount?: number; pendingReviewSequence?: string | null; pendingReviewSince?: string | null; lastResolvedReview?: BillDisposition | null };
export type ZohoBooksPerson = { userId: string; displayName: string };
export type ZohoBooksView = "ALL" | "ATTENTION" | "FOLLOW_UP" | "RESOLVED";
export const zohoBooksSorts = ["UPDATED", "SUPPLIER", "DATE", "AMOUNT_DESC", "AMOUNT_ASC"] as const;
export type ZohoBooksSort = (typeof zohoBooksSorts)[number];
export type ZohoBooksRegisterQuery = { search?: string; sort?: ZohoBooksSort; currency?: string };
export type ZohoBooksDetail = {
  viewerUserId?: string;
  people?: ZohoBooksPerson[];
  connectionId: string;
  connectionRevision: string;
  organizationId: string;
  organizationName: string;
  canManage: boolean;
  current: ZohoObservation;
  selected: ZohoObservation;
  observations: ZohoObservation[];
  events: BillDisposition[];
  openFollowUps: BillDisposition[];
  nextCursor: string | null;
  nextEventCursor: string | null;
  nextFollowUpCursor: string | null;
};
export type ZohoBooksState = {
  viewerUserId?: string;
  people?: ZohoBooksPerson[];
  configured: boolean;
  canManage: boolean;
  connection: {
    id: string;
    revision: string;
    status: ZohoConnectionStatus;
    organizationId: string | null;
    organizationName: string | null;
    coverageStart: string;
    lastSuccessfulSyncAt: string | null;
    nextScheduledAt: string | null;
    failureCode: string | null;
    providerRevocation: "CONFIRMED" | "UNCONFIRMED" | null;
    incident?: ZohoBooksIncident | null;
  } | null;
  organizations: ZohoOrganization[];
  items: ZohoObservation[];
  total: number;
  nextCursor: string | null;
  throughSequence: string;
  register?: { search: string; sort: ZohoBooksSort; currency: string | null; currencies: string[] };
  overview?: { billCount: number; changedBillCount: number; needsReviewCount: number; followUpCount: number; closedCount: number; oldestPendingObservedAt: string | null; earliestFollowUpOn: string | null };
};

const currencies = new Set(Intl.supportedValuesOf("currency"));

export function providerString(value: unknown, field: string, maximum = 240): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) throw new Error(`Unsupported provider field: ${field}.`);
  return value.trim();
}

export function providerId(value: unknown, field: string): string {
  const id = providerString(value, field, 64);
  if (!/^\d+$/.test(id)) throw new Error(`Unsupported provider identifier: ${field}.`);
  return id;
}

export function parseZohoJson(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text, (_key, value: unknown, context?: { source: string }) => {
    if (typeof value !== "number") return value;
    if (!context?.source) throw new Error("Lossless provider number parsing is unavailable.");
    return context.source;
  });
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Provider response must be an object.");
  return parsed as Record<string, unknown>;
}

export function normalizeZohoBill(value: unknown): ZohoBill {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Provider bill must be an object.");
  const bill = value as Record<string, unknown>;
  const date = providerString(bill.date, "date", 10);
  if (!parseIsoDateOnly(date)) throw new Error("Provider bill date is invalid.");
  const currency = providerString(bill.currency_code, "currency_code", 3);
  if (!currencies.has(currency)) throw new Error("Provider bill currency is unsupported.");
  const status = providerString(bill.status, "status");
  if (!(zohoBillStates as readonly string[]).includes(status)) throw new Error("Provider bill state is unsupported.");
  const modified = providerString(bill.last_modified_time, "last_modified_time", 40);
  if (!parseIsoDateOnly(modified.slice(0, 10)) || !/T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/.test(modified)
    || !Number.isFinite(Date.parse(modified))) throw new Error("Provider bill modification time is invalid.");
  const sourceTotal = providerString(bill.total, "total", 64);
  const sourceBalance = providerString(bill.balance, "balance", 64);
  return {
    version: zohoBooksVersion,
    billId: providerId(bill.bill_id, "bill_id"),
    vendorId: providerId(bill.vendor_id, "vendor_id"),
    vendorName: providerString(bill.vendor_name, "vendor_name"),
    billNumber: providerString(bill.bill_number, "bill_number"),
    date,
    status: status as ZohoBill["status"],
    currency,
    totalMinor: decimalToMinorUnits(sourceTotal, currency),
    balanceMinor: decimalToMinorUnits(sourceBalance, currency),
    sourceTotal,
    sourceBalance,
    modifiedAt: new Date(modified).toISOString(),
    basis: "PROVIDER_BILL_TOTAL",
  };
}

export function billChangeKind(previous: ZohoBill | null, current: ZohoBill): Exclude<ZohoBillChange, "BASELINE" | "REMOVED"> | null {
  if (!previous) return "NEW";
  const fields: readonly (keyof ZohoBill)[] = ["vendorId", "vendorName", "billNumber", "date", "status", "currency", "totalMinor", "balanceMinor"];
  if (fields.every((field) => previous[field] === current[field])) return null;
  return current.status === "void" ? "VOIDED" : "AMENDED";
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isSequence = (value: unknown, zero = false): value is string => typeof value === "string"
  && (zero ? /^(0|[1-9]\d{0,18})$/ : /^[1-9]\d{0,18}$/).test(value) && BigInt(value) <= BigInt("9223372036854775807");
const isTimestamp = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const isUuid = (value: unknown) => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
const validPeople = (value: Record<string, unknown>) => (value.viewerUserId === undefined || isUuid(value.viewerUserId))
  && (value.people === undefined || (Array.isArray(value.people) && value.people.length <= 250 && value.people.every(person => isRecord(person) && isUuid(person.userId) && typeof person.displayName === "string" && person.displayName.trim().length > 0 && person.displayName.length <= 240)));

function validReviewMetadata(item: Record<string, unknown>) {
  return (item.reviewRelevance === undefined || ["BASELINE", "INFORMATIONAL", "MATERIAL"].includes(String(item.reviewRelevance)))
    && (item.previousChangeKind === undefined || item.previousChangeKind === null || ["BASELINE", "NEW", "AMENDED", "VOIDED", "REMOVED"].includes(String(item.previousChangeKind)))
    && (item.pendingReviewCount === undefined || (Number.isSafeInteger(item.pendingReviewCount) && Number(item.pendingReviewCount) >= 0))
    && (item.pendingReviewSequence === undefined || item.pendingReviewSequence === null || isSequence(item.pendingReviewSequence))
    && (item.pendingReviewSince === undefined || item.pendingReviewSince === null || isTimestamp(item.pendingReviewSince))
    && (item.lastResolvedReview === undefined || item.lastResolvedReview === null || (isBillDisposition(item.lastResolvedReview) && item.lastResolvedReview.kind === "RESOLVED" && item.lastResolvedReview.billId === (item.bill as ZohoBill)?.billId));
}

export function isZohoBooksPageCursor(value: unknown): value is string {
  if (isSequence(value)) return true;
  if (typeof value !== "string") return false;
  const parts = value.split(".");
  return parts.length === 5 && parts[0] === "r1" && isSequence(parts[1], true) && isSequence(parts[2], true)
    && isSequence(parts[3]) && /^[a-f0-9]{64}$/.test(parts[4]);
}

function isZohoBill(value: unknown): value is ZohoBill {
  if (!isRecord(value)) return false;
  const normalized = normalizeZohoBill({
    bill_id: value.billId, vendor_id: value.vendorId, vendor_name: value.vendorName,
    bill_number: value.billNumber, date: value.date, status: value.status, currency_code: value.currency,
    total: value.sourceTotal, balance: value.sourceBalance, last_modified_time: value.modifiedAt,
  });
  return (Object.keys(normalized) as Array<keyof ZohoBill>).every(key => normalized[key] === value[key]);
}

export function isZohoBooksState(value: unknown): value is ZohoBooksState {
  try {
    if (!isRecord(value) || !validPeople(value) || typeof value.configured !== "boolean" || typeof value.canManage !== "boolean"
      || !Array.isArray(value.organizations) || !Array.isArray(value.items) || value.items.length > 50
      || !Number.isSafeInteger(value.total) || Number(value.total) < value.items.length
      || !isSequence(value.throughSequence, true) || (value.nextCursor !== null && !isZohoBooksPageCursor(value.nextCursor))) return false;
    if (value.overview !== undefined) {
      const overview = value.overview;
      if (!isRecord(overview) || ["billCount", "changedBillCount", "needsReviewCount", "followUpCount", "closedCount"].some(key => !Number.isSafeInteger(overview[key]) || Number(overview[key]) < 0)
        || ["changedBillCount", "needsReviewCount", "followUpCount", "closedCount"].some(key => Number(overview[key]) > Number(overview.billCount))
        || (overview.oldestPendingObservedAt !== null && !isTimestamp(overview.oldestPendingObservedAt))
        || (overview.earliestFollowUpOn !== null && (typeof overview.earliestFollowUpOn !== "string" || !parseIsoDateOnly(overview.earliestFollowUpOn)))) return false;
    }
    if (value.register !== undefined && (!isRecord(value.register) || typeof value.register.search !== "string" || value.register.search.length > 160
      || !(zohoBooksSorts as readonly unknown[]).includes(value.register.sort) || (value.register.currency !== null && !currencies.has(String(value.register.currency)))
      || !Array.isArray(value.register.currencies) || !value.register.currencies.every(currency => typeof currency === "string" && currencies.has(currency)))) return false;
    if (!value.organizations.every(organization => isRecord(organization) && /^\d{1,64}$/.test(String(organization.id))
      && typeof organization.name === "string" && currencies.has(String(organization.currency)) && typeof organization.active === "boolean")) return false;
    const connection = value.connection;
    if (connection === null) return value.items.length === 0 && value.total === 0 && value.throughSequence === "0";
    if (!isRecord(connection) || typeof connection.id !== "string" || !/^[0-9a-f-]{36}$/i.test(connection.id)
      || !isSequence(connection.revision) || !["AUTHORIZING", "AWAITING_ORGANIZATION", "QUEUED", "SYNCING", "READY", "RETRY_WAIT", "REAUTH_REQUIRED", "FAILED", "REVOKED"].includes(String(connection.status))
      || typeof connection.coverageStart !== "string" || !parseIsoDateOnly(connection.coverageStart)
      || (connection.organizationId !== null && (typeof connection.organizationId !== "string" || !/^\d{1,64}$/.test(connection.organizationId)))
      || (connection.organizationName !== null && typeof connection.organizationName !== "string")
      || (connection.lastSuccessfulSyncAt !== null && !isTimestamp(connection.lastSuccessfulSyncAt))
      || (connection.nextScheduledAt !== null && !isTimestamp(connection.nextScheduledAt))
      || (connection.failureCode !== null && typeof connection.failureCode !== "string")
      || ![null, "CONFIRMED", "UNCONFIRMED"].includes(connection.providerRevocation as string | null)) return false;
    if (connection.status === "READY" && (!connection.organizationId || !connection.lastSuccessfulSyncAt)) return false;
    const incident = connection.incident;
    if (incident !== undefined && incident !== null && (!isRecord(incident) || typeof incident.id !== "string" || !/^[0-9a-f-]{36}$/i.test(incident.id)
      || typeof incident.failureCode !== "string" || typeof incident.canResume !== "boolean"
      || (incident.canEscalate !== undefined && typeof incident.canEscalate !== "boolean")
      || !["PENDING", "DELIVERED", "FAILED", "UNCONFIGURED"].includes(String(incident.deliveryStatus))
      || (incident.assignedOperatorUserId !== null && (typeof incident.assignedOperatorUserId !== "string" || !/^[0-9a-f-]{36}$/i.test(incident.assignedOperatorUserId)))
      || !isTimestamp(incident.createdAt) || [incident.deliveredAt, incident.resumedAt, incident.recoveredAt].some(value => value !== null && !isTimestamp(value)))) return false;
    const through = BigInt(value.throughSequence);
    return value.items.every(item => isRecord(item) && validReviewMetadata(item) && isSequence(item.sequence) && BigInt(item.sequence) <= through
      && isZohoBill(item.bill) && isTimestamp(item.observedAt)
      && ["BASELINE", "NEW", "AMENDED", "VOIDED", "REMOVED"].includes(String(item.changeKind))
      && (item.disposition === undefined || item.disposition === null || (isBillDisposition(item.disposition) && item.disposition.sourceSequence === item.sequence && item.disposition.billId === item.bill.billId))
      && (item.openFollowUpCount === undefined || (Number.isSafeInteger(item.openFollowUpCount) && Number(item.openFollowUpCount) >= 0))
      && (item.followUpOn === undefined || item.followUpOn === null || (typeof item.followUpOn === "string" && Boolean(parseIsoDateOnly(item.followUpOn))))
      && (item.responsibleUserId === undefined || item.responsibleUserId === null || isUuid(item.responsibleUserId))
      && (item.previous === null || (isZohoBill(item.previous) && item.previous.billId === item.bill.billId)));
  } catch {
    return false;
  }
}

export function isZohoBooksDetail(value: unknown): value is ZohoBooksDetail {
  try {
    if (!isRecord(value) || !validPeople(value) || typeof value.connectionId !== "string" || !/^[0-9a-f-]{36}$/i.test(value.connectionId)
      || !isSequence(value.connectionRevision) || typeof value.organizationId !== "string" || !/^\d{1,64}$/.test(value.organizationId)
      || typeof value.organizationName !== "string" || typeof value.canManage !== "boolean"
      || !Array.isArray(value.observations) || value.observations.length > 50 || !Array.isArray(value.events) || value.events.length > 50
      || !Array.isArray(value.openFollowUps) || value.openFollowUps.length > 50
      || [value.nextCursor, value.nextEventCursor, value.nextFollowUpCursor].some(cursor => cursor !== null && !isSequence(cursor))) return false;
    const validObservation = (item: unknown) => isRecord(item) && validReviewMetadata(item) && isSequence(item.sequence) && isZohoBill(item.bill)
      && isTimestamp(item.observedAt) && ["BASELINE", "NEW", "AMENDED", "VOIDED", "REMOVED"].includes(String(item.changeKind))
      && (item.previous === null || (isZohoBill(item.previous) && item.previous.billId === item.bill.billId))
      && (item.disposition === null || (isBillDisposition(item.disposition) && item.disposition.sourceSequence === item.sequence && item.disposition.billId === item.bill.billId));
    if (!validObservation(value.current) || !validObservation(value.selected)) return false;
    const billId = ((value.current as Record<string, unknown>).bill as ZohoBill).billId;
    return ((value.selected as Record<string, unknown>).bill as ZohoBill).billId === billId && value.observations.every(item => validObservation(item) && item.bill.billId === billId)
      && value.events.every(item => isBillDisposition(item) && item.billId === billId)
      && value.openFollowUps.every(item => isBillDisposition(item) && item.billId === billId && item.kind === "FOLLOW_UP");
  } catch {
    return false;
  }
}
