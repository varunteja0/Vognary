import { isZohoBooksDetail, isZohoBooksState, type ZohoBooksDetail, type ZohoBooksState, type ZohoBooksView, type ZohoBooksRegisterQuery } from "@/lib/zoho-books/contracts";
import { isBillDisposition, type BillDisposition, type BillDispositionInput } from "@/lib/zoho-books/resolution";

const endpoint = "/api/workspaces/current/sources/zoho-books";

export class BillReviewError extends Error {
  constructor(message: string, readonly unconfirmed = false, readonly status = 0) { super(message); }
}

async function read<Result>(url: string, workspaceId: string, validate: (value: unknown) => value is Result, signal?: AbortSignal): Promise<Result> {
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin", headers: { "X-Vognary-Workspace": workspaceId }, signal });
  const payload: unknown = await response.json();
  if (!response.ok) throw new BillReviewError(response.status === 401 ? "Sign in again to open this bill review." : "The saved bill review could not be opened. Reload before continuing.", false, response.status);
  if (!payload || typeof payload !== "object" || !("data" in payload) || !validate(payload.data)) throw new BillReviewError("The source response could not be verified. No unverified financial values are shown.");
  return payload.data;
}

export function readBillReview(workspaceId: string, view: ZohoBooksView, cursor?: string, signal?: AbortSignal, query: ZohoBooksRegisterQuery = {}): Promise<ZohoBooksState> {
  const params = new URLSearchParams({ view, ...(cursor ? { cursor } : {}) });
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
  return read(`${endpoint}?${params}`, workspaceId, isZohoBooksState, signal);
}

export function readBillDetail(workspaceId: string, billId: string, options: { revision?: string; cursor?: string; eventCursor?: string; followUpCursor?: string } = {}, signal?: AbortSignal): Promise<ZohoBooksDetail> {
  const query = new URLSearchParams(Object.entries(options).filter((entry): entry is [string, string] => entry[1] !== undefined));
  return read(`${endpoint}/bills/${encodeURIComponent(billId)}?${query}`, workspaceId, isZohoBooksDetail, signal);
}

export async function writeBillDisposition(workspaceId: string, input: BillDispositionInput): Promise<BillDisposition> {
  let response: Response;
  try {
    const { billId, idempotencyKey, ...body } = input;
    response = await fetch(`${endpoint}/bills/${encodeURIComponent(billId)}`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "X-Vognary-Workspace": workspaceId, "idempotency-key": idempotencyKey }, body: JSON.stringify(body) });
  } catch {
    throw new BillReviewError("The save result is unconfirmed. Retry this same request to check its saved outcome.", true);
  }
  if (!response.ok) {
    throw new BillReviewError(response.status === 409 ? "This bill or its review changed. Reload the saved review before recording a new disposition."
      : response.status === 403 ? "This workspace is not authorized for that action. An enabled owner or admin is required."
      : response.status === 401 ? "Sign in again. The review has not been confirmed."
      : response.status < 500 ? "The disposition was refused. Check its explanation and follow-up date."
      : "The save result is unconfirmed. Retry this same request to check its saved outcome.", response.status >= 500, response.status);
  }
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new BillReviewError("The save response was interrupted. Retry the original request.", true); }
  if (!payload || typeof payload !== "object" || !("data" in payload) || !isBillDisposition(payload.data)
    || payload.data.billId !== input.billId || payload.data.sourceSequence !== input.sourceSequence || payload.data.kind !== input.kind
    || payload.data.note !== input.note.trim() || payload.data.followUpOn !== input.followUpOn) throw new BillReviewError("The saved outcome could not be verified. Retry the original request.", true);
  return payload.data;
}
