import assert from "node:assert/strict";
import test from "node:test";
import { getConnectorById, getConnectorHonestyState } from "../src/lib/connectors";
import {
  buildConnectorStartResponse,
  buildConnectorSyncPlan,
  getConnectorHonesty,
} from "../src/lib/connector-runtime";

test("inventory adapters never claim financial ledger coverage", () => {
  for (const id of ["github-copilot", "cloudflare-billing", "render-platform", "vercel-platform"]) {
    const connector = getConnectorById(id);
    assert.ok(connector, `${id} must exist`);
    assert.equal(connector.materialization, "source-health-only");
    assert.equal(getConnectorHonestyState(connector), "source-health-only");
    assert.match(connector.evidence, /no |does not/i);
  }
});

test("numeric provider cost evidence remains usage-only until commitment evidence exists", () => {
  const connector = getConnectorById("openai-costs");
  assert.ok(connector);
  assert.equal(connector.materialization, "usage-only");
  assert.equal(getConnectorHonestyState(connector), "usage-only");
});

test("production Gmail readiness stays blocked without its explicit callback URI", () => {
  const connector = getConnectorById("gmail-readonly");
  assert.ok(connector);

  withEnvironment({
    NODE_ENV: "production",
    GOOGLE_CLIENT_ID: "configured-client-id",
    GOOGLE_CLIENT_SECRET: "configured-client-secret",
    GOOGLE_REDIRECT_URI: undefined,
    DATABASE_URL: "postgresql://configured.invalid/vognary",
    TOKEN_ENCRYPTION_KEY: "11".repeat(32),
    GOOGLE_AUTH_CLIENT_ID: undefined,
    GOOGLE_AUTH_CLIENT_SECRET: undefined,
    GOOGLE_OAUTH_VERIFICATION_COMPLETE: "true",
  }, () => {
    const start = buildConnectorStartResponse("gmail-readonly");
    assert.equal(start.state, "needs-configuration");
    assert.deepEqual(start.missingEnv, ["GOOGLE_REDIRECT_URI"]);
    assert.equal(buildConnectorSyncPlan("gmail-readonly").state, "blocked");
    assert.equal(getConnectorHonesty(connector).state, "oauth-required");
  });
});

function withEnvironment(values: Record<string, string | undefined>, run: () => void) {
  const previous = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  try {
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    run();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}
