const baseUrl = (process.argv.find((arg) => arg.startsWith("http://") || arg.startsWith("https://")) || process.env.NEXT_PUBLIC_APP_URL || "https://www.vognary.com").replace(/\/$/, "");
const internalSecret = process.env.INTERNAL_SYNC_SECRET?.trim();

if (process.argv.includes("--help")) {
  console.log(`Send a synthetic server-error event through the production monitoring delivery path.\n\nRequired env:\n  INTERNAL_SYNC_SECRET  Must match production.\n\nUsage:\n  INTERNAL_SYNC_SECRET='...' npm run monitoring:test -- https://www.vognary.com`);
  process.exit(0);
}

if (!internalSecret) {
  console.error("INTERNAL_SYNC_SECRET is required to call the internal monitoring test endpoint.");
  process.exit(1);
}

const response = await fetch(`${baseUrl}/api/internal/monitoring/test`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${internalSecret}`,
  },
});
const payload = await readJson(response);

console.log(JSON.stringify({
  baseUrl,
  observedAt: new Date().toISOString(),
  httpStatus: response.status,
  ok: response.ok,
  payload,
  next: response.ok && payload?.status === "delivered"
    ? "Retain the provider receipt and this output in a restricted record, hash that record, then set MONITORING_DELIVERY_TEST_STATUS, MONITORING_DELIVERY_TEST_AT, and MONITORING_DELIVERY_TEST_RECORD_SHA256 together."
    : "Do not set monitoring readiness evidence. Repair delivery and rerun the test.",
}, null, 2));

if (!response.ok || payload?.status !== "delivered") process.exit(1);

async function readJson(response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return undefined;

  try {
    return await response.json();
  } catch {
    return undefined;
  }
}