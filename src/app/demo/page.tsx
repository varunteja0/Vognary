import type { Metadata } from "next";
import {
  publicArtifactJsonLd,
  publicArtifactMetadata,
} from "@/lib/public-artifacts";
import { DemoClient } from "./demo-client";
import { RequestSheet, SyntheticStamp } from "../record-sheet";
import { syntheticControlBrief, syntheticDemoBranchLabels, syntheticDemoBranchOrder, syntheticDemoBranchOutcomes, syntheticDemoObservedEvidence } from "@/lib/synthetic-control-demo";

export const metadata: Metadata = publicArtifactMetadata;

export default function DemoPage() {
  const branches = syntheticDemoBranchOrder.map(action => {
    const entry = syntheticControlBrief("RECONCILED", action).proposals[0];
    return { action, label: syntheticDemoBranchLabels[action], outcome: syntheticDemoBranchOutcomes[action], decision: entry.decision, reconciliation: entry.reconciliations[0] ?? null };
  });
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(publicArtifactJsonLd).replace(/</g, "\\u003c") }}
      />
      <DemoClient branches={branches} period={syntheticDemoObservedEvidence.period} requestSheet={<RequestSheet headingId="demo-title" />} stamp={<SyntheticStamp className="demo-stamp" />} />
    </>
  );
}
