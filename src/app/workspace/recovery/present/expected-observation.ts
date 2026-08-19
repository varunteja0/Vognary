import type { ExpectedVsObservedDto } from "@/lib/recovery/contracts";
import { formatDay } from "../labels";

export type ExpectedObservationCopy = {
  sentence: string;
  detail: string | null;
};

export function presentExpectedObservation(expectation: ExpectedVsObservedDto): ExpectedObservationCopy | null {
  switch (expectation.status) {
    case "MATCHED":
      return null;
    case "NOT_YET_OBSERVED":
      return {
        sentence: expectation.expectedDate
          ? `We expect this around ${formatDay(expectation.expectedDate)}.`
          : "We haven't seen the next bill yet.",
        detail: "We haven't seen it yet.",
      };
    case "AMOUNT_CHANGED":
      return {
        sentence: amountChangedSentence(expectation),
        detail: expectation.expectedDate ? `We expected this around ${formatDay(expectation.expectedDate)}.` : null,
      };
    case "ARRIVED_LATE":
      return {
        sentence: "This bill arrived later than we expected.",
        detail: expectation.expectedDate ? `We expected this around ${formatDay(expectation.expectedDate)}.` : null,
      };
    case "INSUFFICIENT_HISTORY":
      return {
        sentence: "Not enough history yet.",
        detail: "Add another matching bill if you want a clearer pattern.",
      };
    case "CANNOT_EVALUATE":
      return {
        sentence: "We can't check this against a usual pattern yet.",
        detail: null,
      };
  }
}

function amountChangedSentence(expectation: ExpectedVsObservedDto): string {
  if (expectation.observedAmount && expectation.expectedAmount) {
    return `This bill was ${expectation.observedAmount.display} instead of the usual ${expectation.expectedAmount.display}.`;
  }
  return "This bill was different from the usual amount.";
}
