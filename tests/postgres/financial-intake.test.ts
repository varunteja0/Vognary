import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST as evidence } from "../../src/app/api/workspaces/current/evidence/route";
import { POST as correction } from "../../src/app/api/workspaces/current/commitments/[commitmentId]/corrections/route";
import { PUT as context } from "../../src/app/api/workspaces/current/commitments/[commitmentId]/context/route";
import { POST as audit } from "../../src/app/api/audit/route";
import { POST as ask } from "../../src/app/api/workspaces/current/ask/route";
import { POST as propose } from "../../src/app/api/workspaces/current/control/proposals/route";
import { POST as image } from "../../src/app/api/receipt-image/propose/route";
import { POST as ingest } from "../../src/app/api/ingest/route";
import { PUT as decide } from "../../src/app/api/workspaces/current/decisions/route";
import { getDatabasePool } from "../../src/lib/server/database";
import { createSessionCookie } from "../../src/lib/server/session";

test("financial intake requires workspace clearance before saved input and preserves enabled synthetic access", { skip: !process.env.DATABASE_URL }, async () => {
  const pool = getDatabasePool();
  const ownerId = randomUUID();
  const workspaceId = randomUUID();
  const original = process.env.COMMITMENT_CONTROL_PILOT_WORKSPACE_IDS;
  await pool.query("insert into users (id,email) values ($1,$2)", [ownerId, `synthetic-intake-${ownerId}@example.test`]);
  await pool.query("insert into workspaces (id,owner_user_id,name) values ($1,$2,'Synthetic intake workspace')", [workspaceId, ownerId]);
  await pool.query("insert into workspace_members (workspace_id,user_id,role) values ($1,$2,'owner')", [workspaceId, ownerId]);
  try {
    process.env.COMMITMENT_CONTROL_PILOT_WORKSPACE_IDS = "";
    const cookie = await createSessionCookie({ userId: ownerId, workspaceId });
    const headers = { cookie: `${cookie.name}=${encodeURIComponent(cookie.value)}`, origin: "http://localhost", "content-type": "application/json", "X-Vognary-Workspace": workspaceId };
    const question = new NextRequest("http://localhost/api/workspaces/current/ask", { method: "POST", headers, body: JSON.stringify({ question: "What changed in the synthetic supplier bill?" }) });
    assert.equal((await ask(question)).status, 403);
    assert.equal(question.bodyUsed, false);
    for (const route of [evidence, propose, decide, (request: Request) => correction(request, { params: Promise.resolve({ commitmentId: randomUUID() }) }), (request: Request) => context(request, { params: Promise.resolve({ commitmentId: randomUUID() }) })]) {
      const request = new NextRequest("http://localhost/api/workspaces/current/evidence", { method: "POST", headers, body: JSON.stringify({ kind: "RECEIPT_TEXT", receipts: [{ text: "Synthetic supplier INR 120 on 2026-09-01", clientRef: "synthetic" }] }) });
      assert.equal((await route(request)).status, 403);
      assert.equal(request.bodyUsed, false);
    }
    const body = { manualItems: [{ id: "synthetic", merchant: "Synthetic supplier", amount: 120, currency: "INR", frequency: "semimonthly", nextExpectedDate: "2026-10-01", category: "SaaS" }] };
    const requestAudit = (target = workspaceId) => audit(new NextRequest("http://localhost/api/audit", { method: "POST", headers: { ...headers, "X-Vognary-Workspace": target }, body: JSON.stringify(body) }));
    assert.equal((await requestAudit()).status, 403);
    process.env.COMMITMENT_CONTROL_PILOT_WORKSPACE_IDS = workspaceId;
    const allowed = await requestAudit();
    assert.equal(allowed.status, 200);
    assert.equal((await allowed.json()).cards[0].merchant, "Synthetic supplier");
    assert.equal((await requestAudit(randomUUID())).status, 403);
    const uploadHeaders = { cookie: headers.cookie, origin: headers.origin, "X-Vognary-Workspace": workspaceId };
    const receipt = new FormData();
    receipt.set("file", new File(["Cursor invoice paid USD 20.00 on 2026-08-28.\n"], "synthetic-cursor.png", { type: "image/png" }));
    const extracted = await image(new NextRequest("http://localhost/api/receipt-image/propose", { method: "POST", headers: uploadHeaders, body: receipt }));
    assert.equal(extracted.status, 200);
    assert.equal((await extracted.json()).proposal.amount, "20.00");
    const statement = new FormData();
    statement.set("files", new File(["Date,Description,Debit\n2026-09-01,Synthetic supplier,120"], "synthetic.csv", { type: "text/csv" }));
    const imported = await ingest(new NextRequest("http://localhost/api/ingest", { method: "POST", headers: uploadHeaders, body: statement }));
    assert.equal(imported.status, 200);
    assert.equal((await imported.json()).sources[0].rowCount, 1);
  } finally {
    if (original === undefined) delete process.env.COMMITMENT_CONTROL_PILOT_WORKSPACE_IDS;
    else process.env.COMMITMENT_CONTROL_PILOT_WORKSPACE_IDS = original;
    await pool.query("delete from workspaces where id=$1", [workspaceId]);
    await pool.query("delete from users where id=$1", [ownerId]);
  }
});
