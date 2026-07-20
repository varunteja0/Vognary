export type NakulMomentId = "first-sync" | "savings-minted" | "budget-breach" | "first-evidence";

export type NakulMomentSignals = {
  firstSync: boolean;
  savingsMinted: boolean;
  budgetBreach: boolean;
  firstEvidence: boolean;
};

export type NakulMoment = {
  id: NakulMomentId;
  pose: "found" | "celebrate" | "guide";
  kicker: string;
  title: string;
  detail: string;
};

export const nakulMomentSessionKey = "vognary.nakul.moment-shown.v1";
export const nakulMomentSeenPrefix = "vognary.nakul.seen.v1.";

const moments: Array<{ signal: keyof NakulMomentSignals; moment: NakulMoment }> = [
  {
    signal: "firstSync",
    moment: {
      id: "first-sync",
      pose: "found",
      kicker: "First sync",
      title: "Fresh evidence landed",
      detail: "Nakul found the recurring payments supplied by your approved source.",
    },
  },
  {
    signal: "savingsMinted",
    moment: {
      id: "savings-minted",
      pose: "celebrate",
      kicker: "Verified outcome",
      title: "A saving is now proven",
      detail: "The expected debit passed inside covered evidence without the charge returning.",
    },
  },
  {
    signal: "budgetBreach",
    moment: {
      id: "budget-breach",
      pose: "guide",
      kicker: "Budget watch",
      title: "Monthly burn crossed your limit",
      detail: "Review the highest-impact commitment first; no automatic cancellation will occur.",
    },
  },
  {
    signal: "firstEvidence",
    moment: {
      id: "first-evidence",
      pose: "found",
      kicker: "First evidence",
      title: "Your recurring ledger has a signal",
      detail: "Open the commitment to inspect the evidence and choose what happens next.",
    },
  },
];

export function selectNakulMoment(signals: NakulMomentSignals, seen: ReadonlySet<NakulMomentId> = new Set()): NakulMoment | null {
  return moments.find(({ signal, moment }) => signals[signal] && !seen.has(moment.id))?.moment ?? null;
}