"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { VognaryMark } from "../brand";
import { AuthorityField } from "../authority-field";
import { MoneyValue } from "@/components/ui/money-value";
import { authorityFieldModel, type AuthorityFieldStage } from "@/lib/authority-field";
import { controlReasonLabels } from "../workspace/recovery/control/control-format";
import {
  SYNTHETIC_DEMO_LABEL,
  syntheticDemoBranchLabels,
  syntheticDemoBranchOrder,
  syntheticDemoBranchOutcomes,
  syntheticDemoDecision,
  syntheticDemoEvaluation,
  syntheticDemoHasOutcome,
  syntheticDemoReconciliation,
  type SyntheticDemoBranch,
} from "@/lib/synthetic-control-demo";
import "./demo.css";

/**
 * The demonstration.
 *
 * One record moves through the Authority Field while the reader drives it.
 * Nothing here touches the network, a store or a product API: every fact on
 * screen is produced by the same pure engines the signed-in desk uses, from a
 * fixed synthetic input.
 *
 * The three branches are genuinely different endings. A decline produces no
 * boundary, so it has no later comparison and no reconciled step — the refusal
 * itself is where the record stops.
 */

type Step = "EVIDENCE" | "PROPOSED" | "POLICY" | "DECIDING" | "RESOLVED" | "OBSERVED";

const STEP_LABELS: Record<Step, string> = {
  EVIDENCE: "What is proven",
  PROPOSED: "What is being asked",
  POLICY: "What policy marks",
  DECIDING: "The human line",
  RESOLVED: "The decision",
  OBSERVED: "What actually arrived",
};

const SAY: Record<Step, { title: string; body: string }> = {
  EVIDENCE: {
    title: "Start with the only thing you can prove.",
    body: "Two vendor invoices at the same amount. Nothing has been requested yet, and nothing above these charges is known.",
  },
  PROPOSED: {
    title: "Someone asks for more.",
    body: "An engineering lead wants a higher inference tier before a launch. The amount is typed by a person, so the region between what is proven and what is asked is entirely unsettled.",
  },
  POLICY: {
    title: "Your rule marks the region.",
    body: "A deterministic evaluation against your own policy version. It records what is crossed. It does not approve, it does not refuse, and it cannot close the region.",
  },
  DECIDING: {
    title: "Only a person can end this.",
    body: "You are standing where a founder or admin stands. Whatever you choose is written once, with a name and a time against it.",
  },
  RESOLVED: {
    title: "The record is now fixed.",
    body: "This is what a later argument, a later invoice and a later correction will all be read against.",
  },
  OBSERVED: {
    title: "The charge arrives.",
    body: "Later evidence enters from outside the decision and is measured against the boundary that already existed.",
  },
};

const CHOICE_NOTES: Record<SyntheticDemoBranch, string> = {
  APPROVE_WITH_CAP: "Freeze a boundary below what was asked for.",
  APPROVE: "Freeze a boundary at the amount that was asked for.",
  DECLINE: "Create no boundary at all.",
};

export function DemoClient() {
  const [step, setStep] = useState<Step>("EVIDENCE");
  const [branch, setBranch] = useState<SyntheticDemoBranch | null>(null);
  const outcome = useRef<HTMLDivElement>(null);

  const decided = branch !== null;
  const refused = branch === "DECLINE";
  const hasOutcome = decided && syntheticDemoHasOutcome(branch);

  // Steps that exist on this branch. A decline never grows a reconciled step,
  // so the index cannot offer one.
  const steps: Step[] = ["EVIDENCE", "PROPOSED", "POLICY", "DECIDING"];
  if (decided) steps.push("RESOLVED");
  if (hasOutcome) steps.push("OBSERVED");

  const index = steps.indexOf(step);
  const reachable = decided ? steps.length - 1 : 3;

  const fieldStage: AuthorityFieldStage =
    step === "DECIDING" ? "POLICY"
      : step === "RESOLVED" ? (refused ? "REFUSED" : "AUTHORIZED")
        : step === "OBSERVED" ? "OBSERVED"
          : step;

  const model = authorityFieldModel(fieldStage, branch ?? "APPROVE_WITH_CAP");

  const reset = useCallback(() => {
    setBranch(null);
    setStep("EVIDENCE");
  }, []);

  function choose(action: SyntheticDemoBranch) {
    setBranch(action);
    setStep("RESOLVED");
  }

  // Focus moves only where the available controls change — the moment a
  // decision resolves — so pressing Next repeatedly never loses the button.
  useEffect(() => {
    if (step === "RESOLVED") outcome.current?.focus();
  }, [step]);

  const say = SAY[step];

  return (
    <div className="demo">
      <header className="demo-top">
        <Link href="/" className="demo-home" aria-label="Vognary home">
          <VognaryMark size={24} />
          <span>Vognary</span>
        </Link>
        <p className="demo-stamp" data-testid="synthetic-demonstration-label">{SYNTHETIC_DEMO_LABEL}</p>
      </header>

      <div className="demo-body">
        <AuthorityField stage={fieldStage} branch={branch ?? "APPROVE_WITH_CAP"} labelledBy="demo-title" />

        <div className="demo-panel">
          <div className="demo-say">
            <h1 id="demo-title">{say.title}</h1>
            <p>{say.body}</p>
          </div>

          <nav aria-label="Demonstration steps">
            <ol className="demo-steps">
              {steps.map((item, position) => (
                <li key={item} data-done={position < index ? "true" : "false"}>
                  <button
                    type="button"
                    onClick={() => setStep(item)}
                    disabled={position > reachable}
                    aria-current={item === step ? "step" : undefined}
                  >
                    <span className="demo-step-dot" aria-hidden="true" />
                    <span>{STEP_LABELS[item]}</span>
                  </button>
                </li>
              ))}
            </ol>
          </nav>

          {step === "DECIDING" ? (
            <div className="demo-decision">
              <h2>Your decision</h2>
              <p>Policy has said everything it can say. Nothing moves until a person acts.</p>
              <div className="demo-choices">
                {syntheticDemoBranchOrder.map((action) => (
                  <button
                    key={action}
                    type="button"
                    className="demo-choice"
                    data-action={action}
                    onClick={() => choose(action)}
                  >
                    <span className="demo-choice-label">{syntheticDemoBranchLabels[action]}</span>
                    <span className="demo-choice-note">{CHOICE_NOTES[action]}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {(step === "RESOLVED" || step === "OBSERVED") && branch ? (
            <div className="demo-outcome" data-branch={branch} tabIndex={-1} ref={outcome}>
              <h2>{refused ? "Refused. No boundary exists." : "Authorized. The boundary is frozen."}</h2>
              <p>{syntheticDemoBranchOutcomes[branch]}</p>
              <Outcome branch={branch} step={step} model={model} />
              <div className="demo-next-action">
                {refused ? (
                  <>
                    <Link href="/start" className="btn btn-primary btn-lg">Cite a bill you already hold</Link>
                    <button type="button" className="btn btn-ghost" onClick={reset}>
                      Take the other decision instead
                    </button>
                  </>
                ) : step === "OBSERVED" ? (
                  <>
                    <Link href="/start" className="btn btn-primary btn-lg">Do this with your own bill</Link>
                    <Link href="/pay" prefetch={false}>See pilot scope and price</Link>
                  </>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="demo-bar">
            {step === "DECIDING" ? (
              <p className="demo-choice-note" role="status">Choose above to continue.</p>
            ) : index < steps.length - 1 ? (
              <button
                type="button"
                className="btn btn-primary btn-lg"
                onClick={() => setStep(steps[index + 1])}
              >
                {nextLabel(steps[index + 1])}
              </button>
            ) : null}
            {index > 0 ? (
              <button type="button" className="btn btn-ghost" onClick={() => setStep(steps[index - 1])}>
                Back
              </button>
            ) : null}
            {decided ? (
              <button type="button" className="btn btn-ghost" onClick={reset}>Start over</button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function nextLabel(next: Step): string {
  if (next === "PROPOSED") return "See the request";
  if (next === "POLICY") return "Apply the policy";
  if (next === "DECIDING") return "Take the decision";
  if (next === "OBSERVED") return "Bring the later receipt";
  return "Continue";
}

/**
 * A refusal has no cap, no comparison and no verdict, so this renders a
 * genuinely different set of facts rather than the same table with blanks.
 */
function Outcome({
  branch,
  step,
  model,
}: {
  branch: SyntheticDemoBranch;
  step: Step;
  model: ReturnType<typeof authorityFieldModel>;
}) {
  const decision = syntheticDemoDecision(branch);
  const reconciliation = step === "OBSERVED" ? syntheticDemoReconciliation(branch) : null;

  if (branch === "DECLINE") {
    return (
      <dl className="demo-figures">
        <div>
          <dt>What was asked for</dt>
          <dd>
            <MoneyValue minor={decision.expectedAmountMinor} currency={decision.currency} provenance={{ kind: "assumed" }} />
          </dd>
        </div>
        <div>
          {/* The decision record carries no override reason on a refusal, so none
              is invented here. What it does carry is what policy recorded. */}
          <dt>What policy had recorded</dt>
          <dd>
            <ul className="demo-reasons">
              {syntheticDemoEvaluation.reasonCodes.map((code) => (
                <li key={code}>{controlReasonLabels[code]}</li>
              ))}
            </ul>
          </dd>
        </div>
        <div>
          <dt>What happens next</dt>
          <dd>
            The vendor charge is not authorized. If one appears anyway it stays in your evidence as an
            unauthorized charge — it is never measured against a boundary, because none was created.
          </dd>
        </div>
      </dl>
    );
  }

  return (
    <dl className="demo-figures">
      <div>
        <dt>Frozen by</dt>
        <dd>Founder (placeholder), {new Date(decision.decidedAt).toISOString().slice(0, 10)}</dd>
      </div>
      <div>
        <dt>Authorized boundary</dt>
        <dd>
          <MoneyValue minor={decision.approvedCapMinor} currency={decision.currency} provenance={{ kind: "frozen", label: "Frozen cap" }} />
        </dd>
      </div>
      {reconciliation ? (
        <>
          <div>
            <dt>Observed charge</dt>
            <dd>
              <MoneyValue
                minor={reconciliation.observedAmountMinor}
                currency={reconciliation.observedCurrency ?? decision.currency}
                provenance={{ kind: "observed" }}
              />
            </dd>
          </div>
          <div>
            <dt>Verdict</dt>
            <dd>{verdictSentence(model.verdict)}</dd>
          </div>
        </>
      ) : (
        <div>
          <dt>What happens next</dt>
          <dd>The boundary waits. Nothing has been charged yet, so there is nothing to measure.</dd>
        </div>
      )}
    </dl>
  );
}

function verdictSentence(verdict: ReturnType<typeof authorityFieldModel>["verdict"]): string {
  if (verdict === "OVER_CAP") return "Over the boundary. The overrun is recorded and the authorization is unchanged.";
  if (verdict === "WITHIN_CAP") return "Inside the boundary.";
  if (verdict === "MATCHED") return "Exactly the amount that was authorized.";
  if (verdict === "CURRENCY_MISMATCH") return "A different currency, so the two amounts are not comparable.";
  return "Not evaluated.";
}

