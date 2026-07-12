import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const consentStoreSource = readFileSync(path.join(root, "src/lib/server/consent-store.ts"), "utf8");

const listGrantSource = functionSource("listConsentGrants", "withdrawConsentGrant");
const withdrawGrantSource = functionSource("withdrawConsentGrant", "hasActiveConsentGrant");
const withdrawAuthorizationSource = withdrawGrantSource.slice(0, withdrawGrantSource.indexOf("if (!result.rows[0])"));
const activeGrantSource = consentStoreSource.slice(consentStoreSource.indexOf("export async function hasActiveConsentGrant"));

test("listing consent grants is requester-owned, not workspace-owned", () => {
  assert.match(
    listGrantSource,
    /where user_id = \$1\s+or lower\(subject_email\) = lower\(\$2\)/,
    "list authorization must be limited to the requester user id or subject email",
  );
  assert.doesNotMatch(
    listGrantSource,
    /workspace_id\s*=/,
    "workspace membership must not reveal another member's consent grants",
  );
  assert.match(listGrantSource, /\[input\.userId, input\.email\]/);
});

test("withdrawing a consent grant is requester-owned, not workspace-owned", () => {
  assert.match(
    withdrawAuthorizationSource,
    /where id = \$1\s+and \(\s+user_id = \$2\s+or lower\(subject_email\) = lower\(\$3\)\s+\)/,
    "withdraw authorization must require the grant id and requester ownership",
  );
  assert.doesNotMatch(
    withdrawAuthorizationSource,
    /workspace_id\s*=/,
    "workspace membership must not permit withdrawing another member's consent",
  );
  assert.match(withdrawAuthorizationSource, /\[input\.id, input\.userId, input\.email\]/);
});

test("workspace id is retained only as withdrawal audit context", () => {
  assert.match(
    withdrawGrantSource,
    /if \(input\.workspaceId\) \{\s+await client\.query\(\s+`insert into audit_log \(workspace_id, user_id, action, entity_type, entity_id\)/,
  );
  assert.match(withdrawGrantSource, /\[input\.workspaceId, input\.userId, input\.id\]/);
});

test("active consent checks require requester ownership and the selected workspace", () => {
  assert.match(
    activeGrantSource,
    /and \(user_id = \$2 or lower\(subject_email\) = lower\(\$3\)\)/,
  );
  assert.match(activeGrantSource, /and workspace_id = \$4/);
  assert.match(activeGrantSource, /\[input\.purpose, input\.userId, input\.email, input\.workspaceId\]/);
});

function functionSource(startName: string, endName: string) {
  const start = consentStoreSource.indexOf(`export async function ${startName}`);
  const end = consentStoreSource.indexOf(`export async function ${endName}`, start);
  assert.notEqual(start, -1, `${startName} must exist`);
  assert.notEqual(end, -1, `${endName} must exist after ${startName}`);
  return consentStoreSource.slice(start, end);
}
