import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const profileFiles = readdirSync("src/app/profile")
  .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"));
const client = profileFiles
  .map((file) => readFileSync(`src/app/profile/${file}`, "utf8"))
  .join("\n");
const page = readFileSync("src/app/profile/page.tsx", "utf8");
const sections = readFileSync("src/app/profile/profile-sections.tsx", "utf8");
const clientEntry = readFileSync("src/app/profile/profile-client.tsx", "utf8");

test("profile remains an authenticated route", () => {
  assert.match(page, /readCurrentSession/);
  assert.match(page, /if \(!session\) redirect\("\/login"\)/);
});

test("profile actions preserve their established server contracts", () => {
  assert.match(client, /fetch\("\/api\/profile", \{\s*method: "DELETE"/);
  assert.match(sections, /id="privacy-export"/);
  assert.match(sections, /id="delete-account"/);
  assert.match(client, /sessionStorage\.removeItem\(guestAuditTransferKey\)/);
  assert.match(client, /JSON\.stringify\(\{ confirm: deleteText \}\)/);
  assert.match(client, /localStorage\.removeItem\(localWorkspaceStorageKey\)/);

  assert.match(client, /fetch\("\/api\/privacy\/consents", \{/);
  assert.match(client, /method: options\.consent \? "DELETE" : "POST"/);
  assert.match(client, /fetch\("\/api\/renewal-alerts\/preferences", \{\s*method: "PUT"/);
  assert.match(client, /fetch\("\/api\/platform\/tokens", \{\s*method: "POST"/);
  assert.match(client, /fetch\("\/api\/platform\/tokens", \{\s*method: "DELETE"/);
  assert.match(client, /fetch\("\/api\/privacy\/retention-policy", \{\s*method: "PATCH"/);
  assert.match(client, /fetch\("\/api\/privacy\/requests", \{\s*method: "POST"/);
});

test("profile settings use the required progressive-disclosure groups in task order", () => {
  const groupOrder = ["AccountSection", "NotificationsSection", "PrivacySection", "DeveloperSection", "DangerZoneSection"];
  let previous = -1;
  for (const group of groupOrder) {
    const position = clientEntry.indexOf(`<${group}`);
    assert.ok(position > previous, `${group} should appear after the preceding group`);
    previous = position;
  }
  assert.match(sections, /<details className="panel group overflow-hidden"/);
  assert.match(sections, /name="Account"/);
  assert.match(sections, /name="Notifications"/);
  assert.match(sections, /name="Privacy"/);
  assert.match(sections, /name="Developer"/);
  assert.match(sections, /name="Danger Zone"/);
});

test("each profile action group renders its own live status region", () => {
  assert.equal((sections.match(/<StatusMessage message=/g) ?? []).length, 7);
  assert.match(sections, /role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(client, /setStatus\("danger", "Deleting server data…"\)/);
  assert.match(client, /setStatus\("developer", "Creating a read-only platform token…"\)/);
  assert.match(client, /setStatus\("notifications", next\.enabled/);
  assert.match(client, /setStatus\("privacyConsent", options\.consent/);
  assert.match(client, /setStatus\("privacyData", "Preparing a live privacy export…"\)/);
});

test("touched profile components stay incrementally sized", () => {
  for (const file of profileFiles.filter((name) => name.endsWith(".tsx"))) {
    const lines = readFileSync(`src/app/profile/${file}`, "utf8").split("\n").length;
    assert.ok(lines <= 400, `${file} should stay at or below 400 lines, got ${lines}`);
  }
});
