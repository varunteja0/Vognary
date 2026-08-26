import {
  COMMITMENT_CONTROL_STEPS,
  type CommitmentControlStep,
} from "@/lib/commitment-control-loop";

export function AuthorizationLoop({
  activeStep,
  completedThrough = 0,
  compact = false,
  label = "Commitment Control loop",
}: {
  activeStep?: CommitmentControlStep;
  completedThrough?: 0 | 1 | 2 | 3 | 4 | 5;
  compact?: boolean;
  label?: string;
}) {
  return (
    <ol
      className={compact ? "authorization-loop authorization-loop-compact" : "authorization-loop"}
      aria-label={label}
    >
      {COMMITMENT_CONTROL_STEPS.map((step, index) => {
        const n = (index + 1) as CommitmentControlStep;
        return (
          <li
            key={step}
            aria-current={activeStep === n ? "step" : undefined}
            data-complete={completedThrough >= n ? "true" : undefined}
          >
            {step}
          </li>
        );
      })}
    </ol>
  );
}
