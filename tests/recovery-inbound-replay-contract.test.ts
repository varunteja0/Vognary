import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const processor = readFileSync("src/lib/server/recovery-inbound-processor.ts", "utf8");
const recoveryStore = readFileSync("src/lib/server/recovery-store.ts", "utf8");

test("provider replay keys are durably reserved before a transport event is created", () => {
  assert.match(processor, /recovery_inbound_replay_keys/);
  assert.match(processor, /createHash\("sha256"\)\.update\(event\.svixId\)/);
  assert.match(processor, /createHash\("sha256"\)\.update\(event\.emailId\)/);
  const replayInsert = processor.indexOf("insert into recovery_inbound_replay_keys");
  const eventInsert = processor.indexOf("insert into recovery_inbound_events");
  assert.ok(replayInsert >= 0 && eventInsert > replayInsert);
  assert.match(processor, /replayKeys\.rows\.length !== 2/);
});

test("forwarded materialization idempotency is stable after transport-event retention", () => {
  const materialization = recoveryStore.slice(
    recoveryStore.indexOf("export async function materializeForwardedEmailEvidence"),
    recoveryStore.indexOf("export async function getRecoveryHome"),
  );
  assert.match(materialization, /hashRecoveryRequest\(\{ operation, providerEventId: input\.providerEventId, currencyHint, request \}\)/);
  assert.doesNotMatch(materialization, /hashRecoveryRequest\(\{ operation, inboundEventId/);
});