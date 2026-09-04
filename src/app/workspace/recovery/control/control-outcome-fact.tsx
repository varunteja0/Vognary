import type { IntendedControlOutcome } from "@/lib/commitment-control/outcome";
import { formatDay } from "../labels";
import { ControlFact } from "./control-evaluation";

export function ControlOutcomeFact({ outcome }: { outcome: IntendedControlOutcome | null }) {
  return outcome ? (
    <ControlFact
      label="Outcome target · user-entered assumption"
      value={`${outcome.targetDirection === "AT_LEAST" ? "At least" : "At most"} ${outcome.targetValue} ${outcome.unit} · review ${formatDay(outcome.reviewOn)}`}
    />
  ) : (
    <ControlFact label="Outcome target" value="Not recorded on this legacy proposal" />
  );
}