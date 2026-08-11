import assert from "node:assert/strict";
import test from "node:test";

import { POST as transitionPost } from "../src/app/api/internal/action-cases/[caseId]/transition/route";
import { GET as verificationGet, POST as verificationPost } from "../src/app/api/internal/savings-verification/due/run/route";
import { GET as actionsGet, POST as actionsPost } from "../src/app/api/workspaces/current/actions/route";
import { GET as actionGet, PATCH as actionPatch } from "../src/app/api/workspaces/current/actions/[caseId]/route";
import { POST as authorizePost } from "../src/app/api/workspaces/current/actions/[caseId]/authorize/route";
import { legacyConciergeRetirementPayload } from "../src/lib/legacy-concierge-retirement";

test("every legacy concierge and verification endpoint returns one Recovery retirement contract", async () => {
  const mutation = (method: "POST" | "PATCH") => new Request("https://vognary.test/api/retired", {
    method,
    headers: { origin: "https://vognary.test" },
  });
  const responses = [
    actionsGet(),
    actionsPost(mutation("POST")),
    actionGet(),
    actionPatch(mutation("PATCH")),
    authorizePost(mutation("POST")),
    transitionPost(),
    verificationGet(),
    verificationPost(),
  ];

  for (const response of responses) {
    assert.equal(response.status, 410);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), legacyConciergeRetirementPayload);
  }
});

test("retired browser mutations still reject cross-site requests before responding", () => {
  const crossSite = (method: "POST" | "PATCH") => new Request("https://vognary.test/api/retired", {
    method,
    headers: { origin: "https://attacker.test", "sec-fetch-site": "cross-site" },
  });
  assert.equal(actionsPost(crossSite("POST")).status, 403);
  assert.equal(actionPatch(crossSite("PATCH")).status, 403);
  assert.equal(authorizePost(crossSite("POST")).status, 403);
});