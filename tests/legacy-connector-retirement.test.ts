import assert from "node:assert/strict";
import test from "node:test";

import { GET as registryGet } from "../src/app/api/connectors/route";
import { GET as startGet, POST as startPost } from "../src/app/api/connectors/[id]/start/route";
import { GET as previewGet, POST as previewPost } from "../src/app/api/connectors/[id]/sync/route";
import { POST as webhookPost } from "../src/app/api/connectors/[id]/webhook/route";
import { GET as aaGet, POST as aaPost } from "../src/app/api/integrations/aa/start/route";
import { GET as gmailStartGet } from "../src/app/api/integrations/gmail/start/route";
import { GET as gmailCallbackGet } from "../src/app/api/integrations/gmail/callback/route";
import { POST as accountSyncPost } from "../src/app/api/workspaces/current/connectors/[accountId]/sync/route";
import { POST as internalCreatePost } from "../src/app/api/internal/sync-jobs/route";
import { POST as internalRunPost } from "../src/app/api/internal/sync-jobs/[id]/run/route";
import { GET as internalDueGet, POST as internalDuePost } from "../src/app/api/internal/sync-jobs/due/run/route";
import { legacyConnectorRetirementPayload } from "../src/lib/legacy-connector-retirement";

test("every legacy connector setup and sync endpoint returns one no-store Recovery retirement contract", async () => {
  const context = { params: Promise.resolve({ id: "retired" }) };
  const sameOriginPost = () => new Request("https://vognary.test/api/retired", {
    method: "POST",
    headers: { origin: "https://vognary.test" },
  });
  const responses = await Promise.all([
    registryGet(),
    startGet(),
    startPost(sameOriginPost()),
    previewGet(new Request("https://vognary.test/api/retired"), context),
    previewPost(sameOriginPost(), context),
    webhookPost(sameOriginPost(), context),
    aaGet(),
    aaPost(sameOriginPost()),
    gmailStartGet(),
    gmailCallbackGet(),
    accountSyncPost(sameOriginPost()),
    internalCreatePost(sameOriginPost()),
    internalRunPost(sameOriginPost(), { params: Promise.resolve({ id: "retired" }) }),
    internalDueGet(new Request("https://vognary.test/api/internal/sync-jobs/due/run")),
    internalDuePost(sameOriginPost()),
  ]);

  for (const response of responses) {
    assert.equal(response.status, 410);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), legacyConnectorRetirementPayload);
  }
});