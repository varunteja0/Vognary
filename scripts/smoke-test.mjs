const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";

async function assertOk(path) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response;
}

await assertOk("/");
await assertOk("/launch");
await assertOk("/sources");
await assertOk("/integrations");
await assertOk("/privacy");
await assertOk("/security");

const health = await (await assertOk("/api/health")).json();
if (health.status !== "ok") throw new Error("Health endpoint did not return ok");

const connectors = await (await assertOk("/api/connectors")).json();
if (!connectors.connectors?.length) throw new Error("Connector registry is empty");

const auditResponse = await fetch(`${baseUrl}/api/audit`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    sources: [{ name: "statement.csv", text: "Date,Description,Debit,Credit\n2026-01-01,OPENAI CHATGPT,1999,\n2026-02-01,OPENAI CHATGPT,1999," }],
    manualItems: [],
  }),
});
if (!auditResponse.ok) throw new Error(`Audit endpoint returned ${auditResponse.status}`);
const audit = await auditResponse.json();
if (!audit.audit?.summary) throw new Error("Audit endpoint did not return a summary");

console.log(JSON.stringify({ status: "ok", baseUrl, routes: "verified" }, null, 2));