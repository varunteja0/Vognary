export type ShadowGateSnapshot = {
  connectedMandates: number;
  eligibleCandidates: number;
  protectedLeakage: number;
  passed: boolean;
};

export const shadowGateThresholds = {
  connectedMandates: 10,
  eligibleCandidates: 5,
  protectedLeakage: 0,
} as const;

export type ConnectedMandateFact = {
  mandateStatus: "ACTIVE" | "REVOKED";
  workspaceCurrent: boolean;
  hasActiveRecoverySource: boolean;
  consentCurrent: boolean;
};

export type EligibleCandidateFact = {
  workspaceId?: string;
  mandateActive: boolean;
  classificationCurrent: boolean;
  evidenceFresh: boolean;
  nonTerminal: boolean;
  nonWithdrawn: boolean;
  evaluatorEligible: boolean;
  providerExecutable: boolean;
  providerProven: boolean;
  providerEnabled: boolean;
  noticeDeliverable: boolean;
  sourceConnected: boolean;
  consentCurrent: boolean;
};

export type ProtectedLeakageFact = {
  citedClass: string;
  protectedOverride: boolean;
  conflictingProtected: boolean;
  recordedEligibility: "ELIGIBLE" | "INELIGIBLE" | "PROTECTED" | "UNSUPPORTED_ROUTE";
};

export function evaluateShadowGate(snapshot: Omit<ShadowGateSnapshot, "passed">): ShadowGateSnapshot {
  return {
    ...snapshot,
    passed:
      snapshot.connectedMandates >= shadowGateThresholds.connectedMandates
      && snapshot.eligibleCandidates >= shadowGateThresholds.eligibleCandidates
      && snapshot.protectedLeakage <= shadowGateThresholds.protectedLeakage,
  };
}

export function countsAsConnectedMandate(fact: ConnectedMandateFact): boolean {
  return fact.mandateStatus === "ACTIVE"
    && fact.workspaceCurrent
    && fact.hasActiveRecoverySource
    && fact.consentCurrent;
}

export function countsAsEligibleCandidate(fact: EligibleCandidateFact): boolean {
  return fact.mandateActive
    && fact.classificationCurrent
    && fact.evidenceFresh
    && fact.nonTerminal
    && fact.nonWithdrawn
    && fact.evaluatorEligible
    && fact.providerExecutable
    && fact.providerProven
    && fact.providerEnabled
    && fact.noticeDeliverable
    && fact.sourceConnected
    && fact.consentCurrent;
}

export function countsAsProtectedLeakage(fact: ProtectedLeakageFact): boolean {
  const protectedByFacts = fact.protectedOverride
    || fact.conflictingProtected
    || fact.citedClass !== "discretionary-subscription";
  return fact.recordedEligibility === "ELIGIBLE" && protectedByFacts;
}

export function shadowGateCounts(input: {
  connectedMandateFacts: readonly ConnectedMandateFact[];
  eligibleCandidateFacts: readonly EligibleCandidateFact[];
  leakageFacts: readonly ProtectedLeakageFact[];
}): Omit<ShadowGateSnapshot, "passed"> {
  const connectedMandates = input.connectedMandateFacts.filter(countsAsConnectedMandate).length;
  const eligibleWorkspaces = new Set(
    input.eligibleCandidateFacts
      .filter(countsAsEligibleCandidate)
      .map((fact, index) => fact.workspaceId ?? `anon-${index}`),
  );
  return {
    connectedMandates,
    eligibleCandidates: eligibleWorkspaces.size,
    protectedLeakage: input.leakageFacts.filter(countsAsProtectedLeakage).length,
  };
}

export type ShadowGateEvidence = {
  connectedMandates: number;
  eligibleCandidates: number;
  protectedLeakage: number;
  failReasons: readonly string[];
  snapshotHash: string;
};

/** Test-only skip. Production always requires a measured 10/5/0 pass. */
export function executionMayProceedPastShadowGate(passed: boolean): boolean {
  if (passed) return true;
  if (process.env.NODE_ENV === "production") return false;
  return process.env.AUTOPILOT_TEST_SHADOW_GATE_PASS === "true";
}
