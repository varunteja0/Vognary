/**
 * Same-tab guest assumption. This is not a recorded owner decision and not
 * cited money. /start reads it so the two public doors stay one loop.
 */
export const guestProposalDraftKey = "vognary.guest-proposal-draft.v1";
export const guestProposalDraftTtlMs = 2 * 60 * 60 * 1_000;

const guestProposalActions = ["APPROVE", "APPROVE_WITH_CAP", "DECLINE"] as const;
const maxMerchantLength = 80;

export type GuestProposalAction = (typeof guestProposalActions)[number];

export type GuestProposalDraft = {
  version: 1;
  exportedAt: string;
  merchant: string;
  amountInr: number | null;
  capInr: number | null;
  action: GuestProposalAction;
  usingExample: boolean;
};

function isPositiveInr(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 1_000_000_000_000;
}

export function buildGuestProposalDraft(input: {
  merchant: string;
  amountInr: number | null;
  capInr: number | null;
  action: GuestProposalAction;
  usingExample: boolean;
  exportedAt?: Date;
}): GuestProposalDraft | null {
  const merchant = input.merchant.trim();
  if (!merchant || merchant.length > maxMerchantLength) return null;
  if (input.amountInr != null && !isPositiveInr(input.amountInr)) return null;
  if (input.capInr != null && !isPositiveInr(input.capInr)) return null;
  if (!guestProposalActions.includes(input.action)) return null;
  return {
    version: 1,
    exportedAt: (input.exportedAt ?? new Date()).toISOString(),
    merchant,
    amountInr: input.amountInr,
    capInr: input.capInr,
    action: input.action,
    usingExample: input.usingExample === true,
  };
}

export function parseGuestProposalDraft(raw: string | null, now = new Date()): GuestProposalDraft | null {
  if (!raw || raw.length > 4_096) return null;
  try {
    const value = JSON.parse(raw) as Partial<GuestProposalDraft>;
    if (value.version !== 1 || typeof value.exportedAt !== "string") return null;
    const ageMs = now.getTime() - Date.parse(value.exportedAt);
    if (!Number.isFinite(ageMs) || ageMs < -5 * 60 * 1_000 || ageMs > guestProposalDraftTtlMs) return null;
    return buildGuestProposalDraft({
      merchant: typeof value.merchant === "string" ? value.merchant : "",
      amountInr: value.amountInr ?? null,
      capInr: value.capInr ?? null,
      action: value.action as GuestProposalAction,
      usingExample: value.usingExample === true,
      exportedAt: new Date(value.exportedAt),
    });
  } catch {
    return null;
  }
}

const draftListeners = new Set<() => void>();
let snapshotRaw: string | null | undefined;
let snapshotDraft: GuestProposalDraft | null = null;

function notifyGuestProposalDraft() {
  snapshotRaw = undefined;
  for (const listener of draftListeners) listener();
}

export function writeGuestProposalDraft(input: Parameters<typeof buildGuestProposalDraft>[0]): boolean {
  const draft = buildGuestProposalDraft(input);
  if (!draft) return false;
  try {
    const serialized = JSON.stringify(draft);
    window.sessionStorage.setItem(guestProposalDraftKey, serialized);
    const ok = window.sessionStorage.getItem(guestProposalDraftKey) === serialized;
    if (ok) notifyGuestProposalDraft();
    return ok;
  } catch {
    return false;
  }
}

export function readGuestProposalDraft(): GuestProposalDraft | null {
  try {
    return parseGuestProposalDraft(window.sessionStorage.getItem(guestProposalDraftKey));
  } catch {
    return null;
  }
}

/** For useSyncExternalStore. getSnapshot must be referentially stable when storage is unchanged. */
export function subscribeGuestProposalDraft(onStoreChange: () => void) {
  draftListeners.add(onStoreChange);
  return () => {
    draftListeners.delete(onStoreChange);
  };
}

export function getGuestProposalDraftSnapshot(): GuestProposalDraft | null {
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(guestProposalDraftKey);
  } catch {
    raw = null;
  }
  if (raw === snapshotRaw) return snapshotDraft;
  snapshotRaw = raw;
  snapshotDraft = parseGuestProposalDraft(raw);
  return snapshotDraft;
}

export function getGuestProposalDraftServerSnapshot(): GuestProposalDraft | null {
  return null;
}

export function formatDraftInr(rupees: number): string {
  return `₹${Math.round(rupees).toLocaleString("en-IN")}`;
}

/** Signed-in Control may continue a guest assumption. Example Cursor copy is not a proposal. */
export function controlDraftFromGuestProposal(draft: GuestProposalDraft | null): { merchant: string; amountText?: string } | null {
  if (!draft || draft.usingExample) return null;
  return {
    merchant: draft.merchant,
    ...(draft.amountInr != null ? { amountText: String(draft.amountInr) } : {}),
  };
}
