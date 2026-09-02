"use client";

import Link from "next/link";
import { useState } from "react";
import {
  SYNTHETIC_DEMO_LABEL,
  syntheticControlBrief,
  syntheticDemoBranchLabels,
  syntheticDemoBranchOrder,
  type SyntheticDemoBranch,
} from "@/lib/synthetic-control-demo";
import { ControlProposalRow } from "./control/control-proposal-row";

/**
 * What a workspace sees at the Control destination before pilot enrollment.
 *
 * The public site sells Commitment Control, so the destination stays in
 * navigation and shows the complete loop. It is rendered from the same
 * synthetic record as `/demo`, through the same product components, and is
 * permanently labelled as a demonstration. Nothing here writes, and no control
 * offered here reaches the network.
 */
export function ControlLockedPanel() {
  const [branch, setBranch] = useState<SyntheticDemoBranch>("APPROVE_WITH_CAP");
  const entry = syntheticControlBrief("RECONCILED", branch).proposals[0];

  return (
    <section aria-labelledby="control-locked-heading" className="grid gap-4">
      <header className="grid gap-2">
        <p className="eyebrow eyebrow-xs text-ochre">{SYNTHETIC_DEMO_LABEL}</p>
        <h3 id="control-locked-heading" className="font-display text-xl font-semibold text-(--ink)">
          Live decisions unlock with pilot enrollment
        </h3>
        <p className="max-w-prose text-sm leading-6 text-(--ink-soft)">
          The record below is a placeholder, not this workspace. Enrollment turns this destination into your own desk:
          you enter a proposed obligation, cite exposure you already saved, read deterministic policy context, and a
          named owner or admin freezes a cap. Cited bills you add today keep saving here either way.
        </p>
      </header>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Decision taken in the demonstration">
        {syntheticDemoBranchOrder.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setBranch(option)}
            aria-pressed={option === branch}
            className={option === branch ? "btn btn-sm btn-primary" : "btn btn-sm btn-ghost"}
          >
            {syntheticDemoBranchLabels[option]}
          </button>
        ))}
      </div>

      <ControlProposalRow
        entry={entry}
        canDecide={false}
        pendingKind={null}
        focused={false}
        lead
        online
        onDecide={null}
        onReconcile={null}
        onInspectEvidence={null}
        onFocused={null}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Link href="/pay" className="btn btn-primary">See the pilot offer</Link>
        <Link href="/demo" className="link-quiet text-sm">Walk the demonstration end to end</Link>
      </div>
    </section>
  );
}
