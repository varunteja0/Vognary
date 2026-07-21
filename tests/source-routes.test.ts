import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import nextConfig from "../next.config";

test("legacy source and launch URLs redirect to their single task destinations", async () => {
  assert.equal(typeof nextConfig.redirects, "function");
  const redirects = await nextConfig.redirects!();
  assert.deepEqual(
    redirects.filter((entry) => ["/connect", "/integrations", "/launch"].includes(entry.source)),
    [
      { source: "/connect", destination: "/sources", permanent: true },
      { source: "/integrations", destination: "/sources", permanent: true },
      { source: "/launch", destination: "/private-audit", permanent: true },
    ],
  );
});

test("the source task surface keeps real lifecycle operations behind disclosure", () => {
  const page = source("src/app/sources/page.tsx");
  const setup = source("src/app/sources/source-setup-client.tsx");
  const actions = source("src/app/sources/source-account-actions.tsx");

  assert.match(page, /import \{ connection \} from "next\/server"/);
  assert.match(page, /await connection\(\);\s*const sourceOptions = buildSourceOptions\(\)/);
  assert.match(page, /<SourceHealthClient \/>/);
  assert.match(page, /<SourceSetupClient options=\{sourceOptions\} \/>/);
  assert.doesNotMatch(page, /connectors\.map/);
  assert.match(setup, /<details id="add-source"/);
  assert.match(setup, /\/api\/integrations\/gmail\/start\?mode=json/);
  assert.match(setup, /\/api\/connectors\/\$\{selected\.id\}\/start/);
  assert.match(actions, /\/api\/workspaces\/current\/connectors\/\$\{account\.id\}\/sync/);
  assert.match(actions, /method: "DELETE"/);
  assert.match(actions, /Local credentials were deleted/);
  assert.match(actions, /Retry sync/);

  for (const path of [
    "src/app/sources/source-health-client.tsx",
    "src/app/sources/source-setup-client.tsx",
    "src/app/sources/source-account-actions.tsx",
  ]) {
    assert.ok(source(path).split("\n").length <= 400, `${path} must stay within the touched-module extraction limit`);
  }
});

test("Gmail authorization lands success on the workspace and failures on source health", () => {
  const start = source("src/app/api/integrations/gmail/start/route.ts");
  const callback = source("src/app/api/integrations/gmail/callback/route.ts");
  // The legacy /connect route stays dead everywhere.
  assert.doesNotMatch(`${start}\n${callback}`, /next=\/connect/);
  assert.match(start, /next=\/sources/);
  // Success redirects to /app so the first-sync moment can show what was found…
  assert.match(callback, /`\/app\?gmail=\$\{outcome\}/);
  // …while persistence failures still land on /sources, which explains them.
  assert.match(callback, /`\/sources\?gmail=\$\{encodeURIComponent\(persistence\.status\)\}/);
});

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}
