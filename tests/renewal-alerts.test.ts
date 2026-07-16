import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import { buildRenewalAlertEmail, normalizeRenewalAlertPreferenceInput } from "../src/lib/renewal-alerts";

const root = fileURLToPath(new URL("../", import.meta.url));

test("renewal alerts remain off until enabled and normalize bounded delivery preferences", () => {
  assert.deepEqual(normalizeRenewalAlertPreferenceInput({ enabled: false }), {
    enabled: false,
    sevenDayEnabled: true,
    oneDayEnabled: true,
    timeZone: "UTC",
    sendHourLocal: 9,
  });
  const enabled = normalizeRenewalAlertPreferenceInput({
    enabled: true,
    sevenDayEnabled: false,
    oneDayEnabled: true,
    timeZone: "Asia/Kolkata",
    sendHourLocal: 8,
  });
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.sevenDayEnabled, false);
  assert.equal(enabled.oneDayEnabled, true);
  assert.ok(["Asia/Kolkata", "Asia/Calcutta"].includes(enabled.timeZone));
  assert.equal(enabled.sendHourLocal, 8);
});

test("renewal alert preferences reject ambiguous or unsafe settings", () => {
  assert.throws(() => normalizeRenewalAlertPreferenceInput({}), /enabled must be true or false/i);
  assert.throws(() => normalizeRenewalAlertPreferenceInput({ enabled: true, sevenDayEnabled: false, oneDayEnabled: false }), /at least one reminder/i);
  assert.throws(() => normalizeRenewalAlertPreferenceInput({ enabled: true, timeZone: "Not/A_Time_Zone" }), /valid IANA/i);
  assert.throws(() => normalizeRenewalAlertPreferenceInput({ enabled: true, sendHourLocal: 24 }), /0 through 23/i);
  assert.throws(() => normalizeRenewalAlertPreferenceInput({ enabled: false, hiddenMode: true }), /unknown renewal alert preference/i);
});

test("renewal email HTML escapes provider-controlled merchant text and avoids financial details in the subject", () => {
  const message = buildRenewalAlertEmail({
    merchant: "Cloud <script>alert('x')</script> & Co.",
    renewalDate: "2026-08-18",
    alertWindow: "7_day",
    appBaseUrl: "https://vognary.example/path?ignored=true",
  });

  assert.equal(message.subject, "Upcoming renewal reminder from Vognary");
  assert.doesNotMatch(message.subject, /Cloud|amount|price/i);
  assert.doesNotMatch(message.html, /<script>/i);
  assert.match(message.html, /&lt;script&gt;alert\(&#39;x&#39;\)&lt;\/script&gt; &amp; Co\./);
  assert.match(message.html, /https:\/\/vognary\.example\/app/);
  assert.match(message.text, /August 18, 2026/);
  assert.match(message.text, /date may change/i);
});

test("renewal scheduling and delivery source enforce opt-in, idempotency, bounded retries, and payload minimization", () => {
  const migration = source("infra/postgres/migrations/0006_renewal_alerts.sql");
  const store = source("src/lib/server/renewal-alert-store.ts");
  const ledger = source("src/lib/server/living-ledger-store.ts");
  const mailer = source("src/lib/server/renewal-alert-mailer.ts");
  const worker = source("src/app/api/internal/renewal-alerts/due/run/route.ts");
  const deliveryTable = migration.slice(
    migration.indexOf("create table if not exists renewal_alert_deliveries"),
    migration.indexOf("create index if not exists renewal_alert_deliveries_due_idx"),
  );

  assert.match(migration, /enabled boolean not null default false/);
  assert.match(migration, /unique \(preference_id, recurring_item_id, alert_window, renewal_date\)/);
  assert.doesNotMatch(deliveryTable, /\b(email|merchant|amount|payload|token)\b/i);
  assert.match(store, /\('7_day', 7, p\.seven_day_enabled\)/);
  assert.match(store, /\('1_day', 1, p\.one_day_enabled\)/);
  assert.match(store, /on conflict \(preference_id, recurring_item_id, alert_window, renewal_date\)/);
  assert.match(store, /for update of delivery skip locked/);
  assert.match(store, /attempt_count < \$2/);
  assert.match(store, /consent\.purpose = 'renewal-alerts'/);
  assert.match(ledger, /scheduleRenewalAlertsForWorkspace\(input\.workspaceId, client\)/);
  assert.match(mailer, /AbortSignal\.timeout\(resendTimeoutMs\)/);
  assert.match(mailer, /"idempotency-key": `renewal-alert\/\$\{input\.deliveryId\}`/);
  assert.doesNotMatch(mailer, /console\./);
  assert.doesNotMatch(worker, /console\./);
  assert.doesNotMatch(worker.slice(worker.indexOf("const sent =")), /delivery\.(email|merchant)/);
});

test("Vercel keeps Hobby-compatible daily worker schedules", () => {
  const config = JSON.parse(source("vercel.json")) as { crons: Array<{ path: string; schedule: string }> };
  const paths = config.crons.map((cron) => cron.path);
  assert.ok(paths.includes("/api/internal/sync-jobs/due/run"));
  assert.ok(paths.includes("/api/internal/renewal-alerts/due/run"));
  assert.ok(paths.includes("/api/internal/privacy/retention/run"));
  assert.equal(config.crons.find((cron) => cron.path === "/api/internal/sync-jobs/due/run")?.schedule, "0 0 * * *");
  assert.equal(config.crons.find((cron) => cron.path === "/api/internal/renewal-alerts/due/run")?.schedule, "30 3 * * *");
  assert.equal(config.crons.find((cron) => cron.path === "/api/internal/privacy/retention/run")?.schedule, "30 21 * * *");
});

function source(relativePath: string) {
  return readFileSync(path.join(root, relativePath), "utf8");
}
