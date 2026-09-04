import type { ControlDecisionDto } from "@/lib/commitment-control/contracts";
import { ControlFact } from "./control-evaluation";

export function ControlAuthorizationAmountFacts({ decision }: { decision: ControlDecisionDto }) {
  if (decision.approvedCapMinor === null) {
    return (
      <ControlFact
        label="Refused amount"
        money={{ minor: decision.expectedAmountMinor, currency: decision.currency, provenance: { kind: "frozen", label: "At decision" } }}
      />
    );
  }
  if (decision.approvedCapMinor === decision.expectedAmountMinor) {
    return (
      <ControlFact
        label="Frozen cap"
        money={{ minor: decision.expectedAmountMinor, currency: decision.currency, provenance: { kind: "frozen", label: "Authorized in full" } }}
      />
    );
  }
  return (
    <>
      <ControlFact
        label="Proposed"
        money={{ minor: decision.expectedAmountMinor, currency: decision.currency, provenance: { kind: "frozen", label: "At decision" } }}
      />
      <ControlFact
        label="Authorized cap"
        money={{ minor: decision.approvedCapMinor, currency: decision.currency, provenance: { kind: "frozen", label: "Frozen" } }}
      />
    </>
  );
}