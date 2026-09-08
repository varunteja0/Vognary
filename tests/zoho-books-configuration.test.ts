import assert from "node:assert/strict";
import test from "node:test";
import { readZohoBooksConfiguration, zohoBooksWorkspaceEnabled } from "../src/lib/server/zoho-books-configuration";

test("Zoho configuration is explicit, HTTPS in production, and workspace allowlisted", () => {
  const keys = ["NODE_ENV", "ZOHO_BOOKS_CLIENT_ID", "ZOHO_BOOKS_CLIENT_SECRET", "NEXT_PUBLIC_APP_URL", "ZOHO_BOOKS_PILOT_WORKSPACE_IDS", "COMMITMENT_CONTROL_PILOT_WORKSPACE_IDS", "COMMITMENT_CONTROL_PAID_WORKSPACE_IDS"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const workspace = "11111111-1111-4111-8111-111111111111";
  try {
    for (const key of keys) delete process.env[key];
    assert.equal(readZohoBooksConfiguration(), null);
    assert.equal(zohoBooksWorkspaceEnabled(workspace), false);
    Object.assign(process.env, { NODE_ENV: "production", ZOHO_BOOKS_CLIENT_ID: "synthetic-client", ZOHO_BOOKS_CLIENT_SECRET: "synthetic-secret", NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3037", ZOHO_BOOKS_PILOT_WORKSPACE_IDS: "*" });
    assert.equal(readZohoBooksConfiguration(), null);
    assert.equal(zohoBooksWorkspaceEnabled(workspace), false);
    process.env.NEXT_PUBLIC_APP_URL = "https://vognary.example";
    process.env.ZOHO_BOOKS_PILOT_WORKSPACE_IDS = workspace;
    assert.equal(readZohoBooksConfiguration()?.redirectUri, "https://vognary.example/api/workspaces/current/sources/zoho-books/callback");
    assert.equal(zohoBooksWorkspaceEnabled(workspace), false, "source allowlisting alone cannot bypass paid and assessed production enrollment");
    Object.assign(process.env, { NODE_ENV: "development" });
    assert.equal(zohoBooksWorkspaceEnabled(workspace), true);
    assert.equal(zohoBooksWorkspaceEnabled("22222222-2222-4222-8222-222222222222"), false);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
