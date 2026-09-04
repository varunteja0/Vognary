import type { Metadata } from "next";
import {
  publicArtifactJsonLd,
  publicArtifactMetadata,
} from "@/lib/public-artifacts";
import { DemoClient } from "./demo-client";

export const metadata: Metadata = publicArtifactMetadata;

export default function DemoPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(publicArtifactJsonLd).replace(/</g, "\\u003c") }}
      />
      <DemoClient />
    </>
  );
}
