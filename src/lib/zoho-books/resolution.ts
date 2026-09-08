import { parseIsoDateOnly } from "@/lib/date-only";

export type BillDisposition = {
  id: string;
  eventSequence: string;
  sourceSequence: string;
  version: string;
  billId: string;
  actorUserId: string;
  kind: "FOLLOW_UP" | "RESOLVED";
  note: string;
  followUpOn: string | null;
  responsibleUserId: string | null;
  createdAt: string;
  basis: "HUMAN_REVIEW_NOT_PAYMENT";
};

export type BillDispositionInput = {
  billId: string;
  sourceSequence: string;
  expectedLatestSequence: string;
  expectedVersion: string;
  idempotencyKey: string;
  kind: BillDisposition["kind"];
  note: string;
  followUpOn: string | null;
};

function sequence(value: unknown, allowZero = false): value is string {
  return typeof value === "string" && (allowZero ? /^(0|[1-9]\d{0,18})$/ : /^[1-9]\d{0,18}$/).test(value) && BigInt(value) <= BigInt("9223372036854775807");
}

export function normalizeBillDisposition(value: unknown): BillDispositionInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("A human bill disposition is required.");
  const input = value as Record<string, unknown>;
  const fields = new Set(["billId", "sourceSequence", "expectedLatestSequence", "expectedVersion", "idempotencyKey", "kind", "note", "followUpOn"]);
  if (Object.keys(input).some(key => !fields.has(key)) || typeof input.billId !== "string" || !/^\d{1,64}$/.test(input.billId)
    || !sequence(input.sourceSequence) || !sequence(input.expectedLatestSequence) || !sequence(input.expectedVersion, true)
    || typeof input.idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{8,160}$/.test(input.idempotencyKey)
    || !["FOLLOW_UP", "RESOLVED"].includes(String(input.kind)) || typeof input.note !== "string" || !input.note.trim() || input.note.length > 2000
    || (input.kind === "FOLLOW_UP" ? typeof input.followUpOn !== "string" || !parseIsoDateOnly(input.followUpOn) : input.followUpOn !== null)) {
    throw new Error("Use the exact source revision, a human explanation and a valid follow-up date only when needed.");
  }
  return { billId: input.billId, sourceSequence: input.sourceSequence, expectedLatestSequence: input.expectedLatestSequence,
    expectedVersion: input.expectedVersion, idempotencyKey: input.idempotencyKey, kind: input.kind as BillDisposition["kind"],
    note: input.note.trim(), followUpOn: input.followUpOn as string | null };
}

export function isBillDisposition(value: unknown): value is BillDisposition {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const uuid = (field: unknown) => typeof field === "string" && /^[0-9a-f-]{36}$/i.test(field);
  return uuid(item.id) && uuid(item.actorUserId) && sequence(item.eventSequence) && sequence(item.sourceSequence) && sequence(item.version)
    && typeof item.billId === "string" && /^\d{1,64}$/.test(item.billId)
    && item.basis === "HUMAN_REVIEW_NOT_PAYMENT" && typeof item.note === "string" && item.note.trim().length > 0 && item.note.length <= 2000
    && typeof item.createdAt === "string" && Number.isFinite(Date.parse(item.createdAt))
    && (item.kind === "RESOLVED" ? item.followUpOn === null && item.responsibleUserId === null
      : item.kind === "FOLLOW_UP" && typeof item.followUpOn === "string" && Boolean(parseIsoDateOnly(item.followUpOn)) && item.responsibleUserId === item.actorUserId);
}
