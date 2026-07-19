import { performance } from "node:perf_hooks";

const auditRequestsPerSecond = 200;
const auditDurationSeconds = 10;
const auditP95BudgetMs = 300;
const ingestConcurrency = 20;
const pdfBytes = 8 * 1024 * 1024;
const target = (process.argv.find((argument) => argument.startsWith("http://") || argument.startsWith("https://"))
  || process.env.LOAD_TEST_BASE_URL
  || "http://127.0.0.1:3000").replace(/\/$/, "");

if (process.argv.includes("--help")) {
  console.log(`Exercise the release load budget against a loopback-only Vognary server.

Usage:
  npm run load:gate -- http://127.0.0.1:3000

Profile:
  POST /api/audit   ${auditRequestsPerSecond} requests/second for ${auditDurationSeconds} seconds; every response 200; p95 < ${auditP95BudgetMs} ms
  POST /api/ingest  ${ingestConcurrency} concurrent readable PDFs at exactly ${pdfBytes} bytes; every response 200

Remote targets are always refused. Start a local production build backed by a disposable database.`);
  process.exit(0);
}

assertLoopbackTarget(target);

const auditPayload = JSON.stringify(buildAuditPayload());
const pdf = buildReadablePdf(pdfBytes);

await warmAuditRoute();
const audit = await runAuditLoad();
const ingest = await runIngestLoad();
const failures = [];

if (audit.failed !== 0) failures.push(`${audit.failed} audit requests did not return HTTP 200`);
if (audit.p95Ms >= auditP95BudgetMs) failures.push(`audit p95 ${audit.p95Ms.toFixed(1)} ms must stay below ${auditP95BudgetMs} ms`);
if (audit.offeredRps < auditRequestsPerSecond * 0.95) failures.push(`audit offered rate ${audit.offeredRps.toFixed(1)} rps fell below 95% of target`);
if (ingest.failed !== 0) failures.push(`${ingest.failed} maximum-size PDF ingestions did not return HTTP 200`);

const report = {
  status: failures.length ? "failed" : "passed",
  target,
  profile: {
    auditRequestsPerSecond,
    auditDurationSeconds,
    auditP95BudgetMs,
    ingestConcurrency,
    pdfBytes,
  },
  audit,
  ingest,
  failures,
};

console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;

async function warmAuditRoute() {
  for (let index = 0; index < 5; index += 1) {
    const response = await auditRequest(`198.18.0.${index + 1}`);
    if (response.status !== 200) throw new Error(`Audit warm-up returned HTTP ${response.status}.`);
  }
}

async function runAuditLoad() {
  const total = auditRequestsPerSecond * auditDurationSeconds;
  const intervalMs = 1_000 / auditRequestsPerSecond;
  const epoch = performance.now() + 100;
  const requests = [];
  const starts = [];

  for (let index = 0; index < total; index += 1) {
    const scheduledAt = epoch + index * intervalMs;
    const waitMs = scheduledAt - performance.now();
    if (waitMs > 0) await wait(waitMs);
    starts.push(performance.now());
    requests.push(measureAuditRequest(index));
  }

  const responses = await Promise.all(requests);
  const latencies = responses.map((entry) => entry.latencyMs).sort((left, right) => left - right);
  const scheduledWindowMs = starts.at(-1) - starts[0] + intervalMs;
  const counts = countStatuses(responses);

  return {
    requests: total,
    targetRps: auditRequestsPerSecond,
    offeredRps: total / (scheduledWindowMs / 1_000),
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    p99Ms: percentile(latencies, 0.99),
    maxMs: latencies.at(-1) ?? 0,
    passed: counts[200] ?? 0,
    failed: total - (counts[200] ?? 0),
    statuses: counts,
  };
}

async function measureAuditRequest(index) {
  const address = `198.18.${Math.floor(index / 254) % 254}.${index % 254 + 1}`;
  const startedAt = performance.now();
  try {
    const response = await auditRequest(address);
    await response.arrayBuffer();
    return { status: response.status, latencyMs: performance.now() - startedAt };
  } catch {
    return { status: 0, latencyMs: performance.now() - startedAt };
  }
}

function auditRequest(address) {
  return fetch(`${target}/api/audit`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": address,
    },
    body: auditPayload,
    signal: AbortSignal.timeout(10_000),
  });
}

async function runIngestLoad() {
  const startedAt = performance.now();
  const responses = await Promise.all(Array.from({ length: ingestConcurrency }, (_, index) => ingestPdf(index)));
  const elapsedMs = performance.now() - startedAt;
  const latencies = responses.map((entry) => entry.latencyMs).sort((left, right) => left - right);
  const counts = countStatuses(responses);
  return {
    requests: ingestConcurrency,
    concurrency: ingestConcurrency,
    bytesPerPdf: pdf.byteLength,
    elapsedMs,
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    maxMs: latencies.at(-1) ?? 0,
    passed: counts[200] ?? 0,
    failed: ingestConcurrency - (counts[200] ?? 0),
    statuses: counts,
  };
}

async function ingestPdf(index) {
  const form = new FormData();
  form.append("files", new File([pdf], `load-${index + 1}.pdf`, { type: "application/pdf" }));
  const startedAt = performance.now();
  try {
    const response = await fetch(`${target}/api/ingest`, {
      method: "POST",
      headers: { "x-forwarded-for": `198.19.0.${index + 1}` },
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
    await response.arrayBuffer();
    return { status: response.status, latencyMs: performance.now() - startedAt };
  } catch {
    return { status: 0, latencyMs: performance.now() - startedAt };
  }
}

function buildAuditPayload() {
  const merchants = [
    ["OPENAI CHATGPT PLUS", 1999],
    ["NETFLIX.COM", 649],
    ["SPOTIFY PREMIUM", 119],
    ["ADOBE CREATIVE CLOUD", 1675],
    ["NOTION LABS", 800],
  ];
  const rows = ["Date,Description,Debit,Credit"];
  for (let month = 1; month <= 7; month += 1) {
    for (const [merchant, amount] of merchants) {
      rows.push(`2026-${String(month).padStart(2, "0")}-06,${merchant},${amount},`);
    }
  }
  return {
    sources: [{ name: "release-load.csv", text: rows.join("\n") }],
    manualItems: [],
    receiptTexts: [],
  };
}

function buildReadablePdf(targetBytes) {
  const chunks = [];
  const offsets = [0];
  let length = 0;
  const append = (value) => {
    const buffer = Buffer.from(value, "ascii");
    chunks.push(buffer);
    length += buffer.length;
  };
  const object = (id, value) => {
    offsets[id] = length;
    append(`${id} 0 obj\n${value}\nendobj\n`);
  };

  append("%PDF-1.4\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  object(3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>");
  const stream = "BT /F1 12 Tf 72 720 Td (Readable Vognary load-test statement) Tj ET";
  object(4, `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  object(5, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  const prefix = Buffer.concat(chunks);
  let fillerBytes = targetBytes - prefix.length;
  let suffix;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const xrefOffset = prefix.length + fillerBytes;
    suffix = Buffer.from(buildPdfSuffix(offsets, xrefOffset), "ascii");
    const nextFillerBytes = targetBytes - prefix.length - suffix.length;
    if (nextFillerBytes === fillerBytes) break;
    fillerBytes = nextFillerBytes;
  }
  if (!suffix || fillerBytes < 0) throw new Error("Could not build the maximum-size PDF fixture.");

  const pdf = Buffer.concat([prefix, Buffer.alloc(fillerBytes, 0x20), suffix]);
  if (pdf.byteLength !== targetBytes) throw new Error(`PDF fixture is ${pdf.byteLength} bytes, expected ${targetBytes}.`);
  return pdf;
}

function buildPdfSuffix(offsets, xrefOffset) {
  const entries = ["0000000000 65535 f "];
  for (let id = 1; id <= 5; id += 1) entries.push(`${String(offsets[id]).padStart(10, "0")} 00000 n `);
  return `xref\n0 6\n${entries.join("\n")}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
}

function assertLoopbackTarget(value) {
  const url = new URL(value);
  if (url.protocol !== "http:") throw new Error("Load gate accepts only an HTTP loopback target.");
  if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw new Error("Load gate refuses non-loopback targets; production and shared environments must never be load-tested by this command.");
  }
  if (url.username || url.password) throw new Error("Load gate target must not contain credentials.");
}

function percentile(sorted, fraction) {
  if (!sorted.length) return 0;
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function countStatuses(responses) {
  return responses.reduce((counts, response) => {
    counts[response.status] = (counts[response.status] ?? 0) + 1;
    return counts;
  }, {});
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
