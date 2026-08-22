import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import { buildRenewalAlertEmail, buildWeeklyDigestEmail, normalizeRenewalAlertPreferenceInput } from "../src/lib/renewal-alerts";

const root = fileURLToPath(new URL("../", import.meta.url));

test("renewal alerts remain off until enabled and normalize bounded delivery preferences", () => {
  assert.deepEqual(normalizeRenewalAlertPreferenceInput({ enabled: false }), {
    enabled: false,
    weeklyDigestEnabled: false,
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
  assert.equal(enabled.weeklyDigestEnabled, false);
  assert.equal(enabled.sevenDayEnabled, false);
  assert.equal(enabled.oneDayEnabled, true);
  assert.ok(["Asia/Kolkata", "Asia/Calcutta"].includes(enabled.timeZone));
  assert.equal(enabled.sendHourLocal, 8);
});

test("weekly digest stays a separate opt-in and keeps currencies separate", () => {
  const preference = normalizeRenewalAlertPreferenceInput({ enabled: false, weeklyDigestEnabled: true });
  assert.equal(preference.enabled, false);
  assert.equal(preference.weeklyDigestEnabled, true);

  const message = buildWeeklyDigestEmail({
    weekStart: "2026-07-20",
    monthlyTotals: [
      { currency: "INR", minor: "282900", exponent: 2, display: "₹2,829.00" },
      { currency: "USD", minor: "2000", exponent: 2, display: "$20.00" },
      { currency: "JPY", minor: "9007199254740991", exponent: 0, display: "JP¥9,007,199,254,740,991" },
    ],
    renewalCountNext7Days: 2,
    renewalTotalsNext7Days: [{ currency: "INR", minor: "199900", exponent: 2, display: "₹1,999.00" }],
    suggestion: { merchant: "Cloud <script>", monthlyCost: { currency: "INR", minor: "199900", exponent: 2, display: "₹1,999.00" } },
    appBaseUrl: "https://vognary.example",
  });
  assert.equal(message.subject, "Your weekly recurring-money review from Vognary");
  assert.doesNotMatch(message.subject, /2829|Cloud|USD/i);
  assert.match(message.text, /Monthly recurring burn/);
  assert.match(message.text, /Other currencies, kept separate/);
  assert.match(message.text, /JP¥9,007,199,254,740,991/);
  assert.doesNotMatch(message.html, /<script>/i);
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

test("reminder UI never presents eligibility or preference state as delivery proof", () => {
  const home = source("src/app/workspace/recovery/recovery-home.tsx");
  const profile = source("src/app/profile/profile-sections.tsx");

  assert.doesNotMatch(home, /Eligible for an opt-in reminder/);
  assert.doesNotMatch(home, /Reminder active|Vognary emails you/);
  assert.match(profile, /When enabled, a Monday digest is scheduled/);
  assert.doesNotMatch(profile, /Sent on Monday/);
});

test("renewal scheduling and delivery source enforce opt-in, idempotency, bounded retries, and payload minimization", () => {
  const migration = source("infra/postgres/migrations/0006_renewal_alerts.sql");
  const digestMigration = source("infra/postgres/migrations/0022_weekly_digest.sql");
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
  assert.match(store, /on conflict \(preference_id, recovery_commitment_id, alert_window, renewal_date\)/);
  assert.match(store, /for update of delivery skip locked/);
  assert.match(store, /attempt_count < \$2/);
  assert.match(store, /consent\.purpose = 'renewal-alerts'/);
  assert.match(ledger, /scheduleRenewalAlertsForWorkspace\(input\.workspaceId, client\)/);
  assert.match(mailer, /AbortSignal\.timeout\(resendTimeoutMs\)/);
  assert.match(mailer, /`renewal-alert\/\$\{input\.deliveryId\}`/);
  assert.match(mailer, /`weekly-digest\/\$\{input\.deliveryId\}`/);
  assert.match(digestMigration, /unique \(preference_id, week_start\)/);
  assert.doesNotMatch(digestMigration.slice(digestMigration.indexOf("create table")), /\b(email|merchant|amount|payload|token)\b/i);
  assert.match(store, /for update of delivery skip locked/);
  assert.match(store, /extract\(isodow from preference\.local_now\) = 1/);
  assert.doesNotMatch(store, /from candidates\s+where scheduled_for <= now\(\)/, "Monday rows must survive a worker run before the chosen local hour");
  assert.match(store, /const weeklyDigestItemsSql = `[\s\S]*from recovery_commitments commitment/);
  const digestProjection = store.match(/const weeklyDigestItemsSql = `([\s\S]*?)`;/)?.[1] ?? "";
  assert.match(digestProjection, /effective_status = 'ACTIVE'/);
  assert.doesNotMatch(digestProjection, /confidence_score >= 80/);
  assert.match(store, /commitment\.effective_monthly_minor as monthly_minor/);
  assert.doesNotMatch(store, /effective_(?:amount|monthly)_minor::numeric \/ 100/);
  assert.doesNotMatch(store, /Number\(row\.(?:monthly_burn|renewal_total|suggestion_monthly_cost)/);
  assert.match(store, /function recoveryReminderEligibilitySql/);
  assert.match(store, /renewalAlertRepeatedEvidenceMinimumConfidence/);
  assert.match(store, /recovery_commitment_evidence/);
  assert.match(store, /effective_cadence <> 'IRREGULAR'/);
  assert.match(store, /item\.user_decision is distinct from 'KEEP'/);
  assert.match(store, /= '1_day' or decision\.decision is distinct from 'KEEP'/);
  assert.match(store, /item\.confidence_score >= 80/);
  assert.doesNotMatch(store, /exists \(select 1 from recurring_items item where item\.workspace_id = (?:preference|delivery)\.workspace_id\)/);
  assert.doesNotMatch(mailer, /console\./);
  assert.doesNotMatch(worker, /console\./);
  assert.doesNotMatch(worker.slice(worker.indexOf("const sent =")), /delivery\.(email|merchant)/);
});

test("Vercel keeps Hobby-compatible daily worker schedules", () => {
  const config = JSON.parse(source("vercel.json")) as { crons: Array<{ path: string; schedule: string }> };
  const paths = config.crons.map((cron) => cron.path);
  assert.ok(!paths.includes("/api/internal/sync-jobs/due/run"));
  assert.ok(paths.includes("/api/internal/renewal-alerts/due/run"));
  assert.ok(paths.includes("/api/internal/privacy/retention/run"));
  assert.equal(config.crons.find((cron) => cron.path === "/api/internal/renewal-alerts/due/run")?.schedule, "30 3 * * *");
  assert.equal(config.crons.find((cron) => cron.path === "/api/internal/privacy/retention/run")?.schedule, "30 21 * * *");
});

function source(relativePath: string) {
  return readFileSync(path.join(root, relativePath), "utf8");
}
