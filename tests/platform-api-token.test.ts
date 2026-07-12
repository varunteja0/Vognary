import assert from "node:assert/strict";
import test from "node:test";

import { normalizePlatformApiScopes, platformApiScopes } from "../src/lib/platform-api";

test("platform API scopes are explicit, read-only, and de-duplicated", () => {
  assert.deepEqual(normalizePlatformApiScopes(["ledger:read", "ledger:read", "sources:read"]), ["ledger:read", "sources:read"]);
  assert.deepEqual(platformApiScopes, ["ledger:read", "sources:read"]);
  assert.throws(() => normalizePlatformApiScopes(["ledger:write"]), /must use/);
  assert.throws(() => normalizePlatformApiScopes([]), /must use/);
});
