import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const packPath = new URL("../docs/research-content-pack-2026-07-16.md", import.meta.url);
const pack = readFileSync(packPath, "utf8");

const deliverable1 = section("# Deliverable 1 - Prospect List", "# Deliverable 2 - Expert-Pass Savings Playbook");
const deliverable2 = section("# Deliverable 2 - Expert-Pass Savings Playbook", "# Deliverable 3 - Outreach Personalization");
const deliverable3 = section("# Deliverable 3 - Outreach Personalization", "# Deliverable 4 - Objection Bank and Content Template");
const deliverable4 = pack.slice(pack.indexOf("# Deliverable 4 - Objection Bank and Content Template"));

const csvMatch = deliverable1.match(/```csv\r?\n([\s\S]*?)\r?\n```/);
assert.ok(csvMatch, "Deliverable 1 must contain a fenced CSV prospect list.");
const prospectRows = parseCsv(csvMatch[1]);
assert.deepEqual(prospectRows[0], [
  "Company",
  "Founder (as printed)",
  "Round",
  "Amount",
  "Announced Date",
  "Segment",
  "Source URL",
  "Why-now hook",
]);
assert.equal(prospectRows.length - 1, 100, "Deliverable 1 must contain exactly 100 prospect rows.");

const companies = new Set();
for (const [index, row] of prospectRows.slice(1).entries()) {
  const rowNumber = index + 2;
  assert.equal(row.length, 8, `Prospect CSV row ${rowNumber} must contain exactly 8 columns.`);
  const [company, founder, round, amount, announcedDate, segment, sourceUrl, hook] = row;
  assert.ok(company && founder && amount && hook, `Prospect CSV row ${rowNumber} has an empty required field.`);
  assert.ok(!companies.has(company), `Prospect company must be unique: ${company}`);
  companies.add(company);
  assert.ok(["Pre-Seed", "Seed", "Pre-Series A"].includes(round), `Unexpected round at row ${rowNumber}: ${round}`);
  assert.ok(["AI", "SaaS", "D2C", "Fintech", "Services", "Other"].includes(segment), `Unexpected segment at row ${rowNumber}: ${segment}`);
  assert.match(announcedDate, /^\d{4}-\d{2}-\d{2}$/, `Invalid announcement date at row ${rowNumber}.`);
  assert.ok(announcedDate >= "2026-04-18" && announcedDate <= "2026-07-16", `Announcement date falls outside the stated 90-day window at row ${rowNumber}.`);
  assert.equal(new URL(sourceUrl).protocol, "https:", `Prospect source must use HTTPS at row ${rowNumber}.`);
}

assertNumberedHeadings(deliverable2, "###", 43, "tool playbooks");
for (const block of numberedBlocks(deliverable2, "###")) {
  for (const field of ["**Source/status:**", "**Trap/right-size:**", "**Math:**", "**Change path:**", "**Savings:**"]) {
    assert.ok(block.includes(field), `${block.split("\n", 1)[0]} is missing ${field}`);
  }
  assert.ok(block.includes("`ESTIMATE"), `${block.split("\n", 1)[0]} must label its savings as an estimate.`);
}

assertNumberedHeadings(deliverable3, "##", 20, "outreach prospects");
const outreachVariants = [...deliverable3.matchAll(/^\*\*Variant ([AB]):\*\* (.+)$/gm)];
assert.equal(outreachVariants.length, 40, "Deliverable 3 must contain exactly 40 outreach variants.");
for (const block of numberedBlocks(deliverable3, "##")) {
  assert.equal((block.match(/^\*\*Variant A:\*\*/gm) ?? []).length, 1, `${block.split("\n", 1)[0]} must contain one Variant A.`);
  assert.equal((block.match(/^\*\*Variant B:\*\*/gm) ?? []).length, 1, `${block.split("\n", 1)[0]} must contain one Variant B.`);
}
for (const [, variant, copy] of outreachVariants) {
  const words = copy.trim().split(/\s+/).length;
  assert.ok(words < 80, `Outreach Variant ${variant} exceeds the stated 80-word limit (${words} words).`);
  assert.ok(copy.includes("₹__L/yr"), `Outreach Variant ${variant} must retain the audited-savings placeholder.`);
}

assertNumberedHeadings(deliverable4, "##", 10, "objection responses");
assert.ok(pack.includes("**Publication rule:**"), "The content pack must retain its explicit publication-consent rule.");
assert.ok(pack.includes("Vognary does not send outreach automatically."), "The content pack must retain its no-automatic-outreach disclosure.");

console.log("Research content pack check passed: 100 prospects, 43 playbooks, 40 outreach variants, 10 objections.");

function section(startMarker, endMarker) {
  const start = pack.indexOf(startMarker);
  const end = pack.indexOf(endMarker);
  assert.ok(start >= 0, `Missing section: ${startMarker}`);
  assert.ok(end > start, `Missing or misplaced section: ${endMarker}`);
  return pack.slice(start, end);
}

function assertNumberedHeadings(value, level, expectedCount, label) {
  const headings = [...value.matchAll(new RegExp(`^${level} (\\d{2})\\. `, "gm"))]
    .map((match) => Number(match[1]));
  assert.deepEqual(headings, Array.from({ length: expectedCount }, (_, index) => index + 1), `Expected sequential ${label} numbered 01-${expectedCount}.`);
}

function numberedBlocks(value, level) {
  const matches = [...value.matchAll(new RegExp(`^${level} \\d{2}\\. .+$`, "gm"))];
  return matches.map((match, index) => value.slice(match.index, matches[index + 1]?.index ?? value.length));
}

function parseCsv(value) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '"') {
      if (quoted && value[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if (char === "\n" && !quoted) {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r" || quoted) {
      field += char;
    }
  }

  assert.equal(quoted, false, "Prospect CSV contains an unterminated quoted field.");
  row.push(field);
  rows.push(row);
  return rows;
}
