import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import nextConfig from "../next.config";

test("legacy public URLs redirect to canonical launch destinations", async () => {
  assert.equal(typeof nextConfig.redirects, "function");
  const redirects = await nextConfig.redirects!();
  assert.deepEqual(
    redirects.filter((entry) => [
      "/connect",
      "/integrations",
      "/sources",
      "/guide",
      "/partners",
      "/beta-readiness",
      "/integration-model",
      "/launch",
      "/private-audit",
    ].includes(entry.source)),
    [
      { source: "/connect", destination: "/app", permanent: true },
      { source: "/integrations", destination: "/app", permanent: true },
      { source: "/sources", destination: "/app", permanent: true },
      { source: "/guide", destination: "/", permanent: true },
      { source: "/partners", destination: "/", permanent: true },
      { source: "/beta-readiness", destination: "/", permanent: true },
      { source: "/integration-model", destination: "/", permanent: true },
      { source: "/launch", destination: "/login?next=/app", permanent: true },
      { source: "/private-audit", destination: "/login?next=/app", permanent: true },
    ],
  );
});

test("direct brand and verification utilities stay out of search discovery", () => {
  for (const path of ["src/app/brand/page.tsx", "src/app/verify/page.tsx", "src/app/start/page.tsx"]) {
    const page = source(path);
    assert.match(page, /robots: \{ index: false, follow: false \}/);
  }
});

test("legacy Gmail authorization is retired without a route back into legacy sources", () => {
  const start = source("src/app/api/integrations/gmail/start/route.ts");
  const callback = source("src/app/api/integrations/gmail/callback/route.ts");
  assert.doesNotMatch(`${start}\n${callback}`, /\/sources/);
  assert.match(start, /legacyConnectorRetiredResponse/);
  assert.match(callback, /legacyConnectorRetirementPayload/);
  assert.doesNotMatch(`${start}\n${callback}`, /upsertConnectedAccount|runConnectorSyncJob/);
});

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}
