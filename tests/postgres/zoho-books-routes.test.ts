import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { GET, POST } from "../../src/app/api/workspaces/current/sources/zoho-books/route";
import { GET as billDetail, POST as billDisposition } from "../../src/app/api/workspaces/current/sources/zoho-books/bills/[billId]/route";
import { GET as callback } from "../../src/app/api/workspaces/current/sources/zoho-books/callback/route";
import { GET as scheduled } from "../../src/app/api/internal/zoho-books/due/run/route";
import { getDatabasePool } from "../../src/lib/server/database";
import { createSessionCookie } from "../../src/lib/server/session";

test("real source handlers complete a synthetic consent/import/update/revoke lifecycle", {
  skip: !process.env.DATABASE_URL,
}, async context => {
  const pool = getDatabasePool();
  const ownerId = randomUUID();
  const workspaceId = randomUUID();
  const keys = ["ZOHO_BOOKS_CLIENT_ID", "ZOHO_BOOKS_CLIENT_SECRET", "ZOHO_BOOKS_PILOT_WORKSPACE_IDS", "NEXT_PUBLIC_APP_URL", "CRON_SECRET"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { ZOHO_BOOKS_CLIENT_ID: "synthetic-client", ZOHO_BOOKS_CLIENT_SECRET: "synthetic-secret", ZOHO_BOOKS_PILOT_WORKSPACE_IDS: workspaceId, NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3037", CRON_SECRET: "synthetic-cron-credential-for-fixture-only" });
  await pool.query("insert into users (id,email) values ($1,$2)", [ownerId, `zoho-http-${ownerId}@example.test`]);
  await pool.query("insert into workspaces (id,owner_user_id,name) values ($1,$2,'Synthetic HTTP Books workspace')", [workspaceId, ownerId]);
  await pool.query("insert into workspace_members (workspace_id,user_id,role) values ($1,$2,'owner')", [workspaceId, ownerId]);
  let amount = 120;
  let providerReads = 0;
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
    if (url.pathname === "/oauth/v2/token") return json({ access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_in: 3600, api_domain: "https://www.zohoapis.in" });
    if (url.pathname === "/oauth/v2/token/revoke") return json({ status: "success" });
    if (url.pathname.endsWith("/organizations")) return json({ code: 0, organizations: [{ organization_id: "100001", name: "Synthetic HTTP organization", currency_code: "INR", is_org_active: true }] });
    if (url.pathname.endsWith("/bills")) {
      providerReads += 1;
      return json({ code: 0, bills: [{ bill_id: "200001", vendor_id: "300001", vendor_name: "Synthetic HTTP vendor", bill_number: "SYNTHETIC-HTTP", date: "2026-09-01", currency_code: "INR", status: "open", total: amount, balance: amount, last_modified_time: "2026-09-06T12:00:00+0530" }], page_context: { page: 1, has_more_page: false } });
    }
    throw new Error(`Unapproved network path in source test: ${url.origin}${url.pathname}`);
  });
  try {
    const cookie = await createSessionCookie({ userId: ownerId, workspaceId });
    const headers = { cookie: `${cookie.name}=${encodeURIComponent(cookie.value)}`, origin: "http://127.0.0.1:3037", "content-type": "application/json", "X-Vognary-Workspace": workspaceId };
    const endpoint = "http://127.0.0.1:3037/api/workspaces/current/sources/zoho-books";
    const action = (body: unknown) => POST(new Request(endpoint, { method: "POST", headers, body: JSON.stringify(body) }));
    assert.equal((await action(null)).status, 400);
    assert.equal((await action({ action: "AUTHORIZE" })).status, 400);
    const begin = await action({ action: "AUTHORIZE", consentVersion: "zoho-books-read-v1" });
    assert.equal(begin.status, 200);
    const state = new URL((await begin.json()).data.authorizationUrl).searchParams.get("state")!;
    const callbackResponse = await callback(new Request(`${endpoint}/callback?state=${state}&code=synthetic-code`, { headers }));
    assert.equal(callbackResponse.status, 303);
    let snapshot = (await (await GET(new Request(endpoint, { headers }))).json()).data;
    assert.equal(snapshot.connection.status, "AWAITING_ORGANIZATION");
    assert.equal((await action({ action: "SELECT", organizationId: "100001", revision: snapshot.connection.revision })).status, 200);
    snapshot = (await (await GET(new Request(endpoint, { headers }))).json()).data;
    assert.equal(snapshot.items[0].bill.totalMinor, "12000");
    amount = 130;
    await pool.query("update zoho_books_connections set next_run_at=now()-interval '1 minute' where workspace_id=$1", [workspaceId]);
    assert.equal((await scheduled(new Request("http://127.0.0.1:3037/api/internal/zoho-books/due/run"))).status, 401);
    const worker = await new Promise<Response>((resolve, reject) => {
      setTimeout(() => {
        void scheduled(new Request("http://127.0.0.1:3037/api/internal/zoho-books/due/run", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } })).then(resolve, reject);
      }, 25);
    });
    assert.equal(worker.status, 200);
    snapshot = (await (await GET(new Request(endpoint, { headers }))).json()).data;
    assert.equal(snapshot.items[0].bill.totalMinor, "13000");
    assert.equal(snapshot.items[0].previous.totalMinor, "12000");
    assert.equal((await action({ action: "REVIEW", throughSequence: snapshot.throughSequence, revision: snapshot.connection.revision })).status, 400);
    const acknowledged = await action({ action: "REVIEW", sequences: [snapshot.items[0].sequence], revision: snapshot.connection.revision });
    assert.equal(acknowledged.status, 200);
    snapshot = (await acknowledged.json()).data;
    assert.equal((await (await GET(new Request(`${endpoint}?changes=true`, { headers }))).json()).data.total, 0);
    const detailUrl = `${endpoint}/bills/200001`;
    const routeContext = { params: Promise.resolve({ billId: "200001" }) };
    const detail = await billDetail(new Request(detailUrl, { headers }), routeContext);
    assert.equal(detail.status, 200);
    const detailData = (await detail.json()).data;
    const body = { sourceSequence: detailData.current.sequence, expectedLatestSequence: detailData.current.sequence, expectedVersion: "0", kind: "RESOLVED", note: "Synthetic HTTP review complete; not payment evidence.", followUpOn: null };
    const dispositionHeaders = { ...headers, "idempotency-key": `synthetic-http-disposition-${randomUUID()}` };
    const saveDisposition = () => billDisposition(new Request(detailUrl, { method: "POST", headers: dispositionHeaders, body: JSON.stringify(body) }), routeContext);
    const saved = await saveDisposition();
    assert.equal(saved.status, 200);
    const savedData = (await saved.json()).data;
    assert.equal(savedData.basis, "HUMAN_REVIEW_NOT_PAYMENT");
    assert.equal((await (await saveDisposition()).json()).data.id, savedData.id);
    assert.equal((await (await GET(new Request(`${endpoint}?view=ATTENTION`, { headers }))).json()).data.total, 0);
    const forbidden = await billDisposition(new Request(detailUrl, { method: "POST", headers: { ...dispositionHeaders, "X-Vognary-Workspace": randomUUID() }, body: JSON.stringify(body) }), routeContext);
    assert.equal(forbidden.status, 403);
    assert.equal((await action({ action: "DISCONNECT", revision: snapshot.connection.revision })).status, 200);
    const stoppedAt = providerReads;
    await scheduled(new Request("http://127.0.0.1:3037/api/internal/zoho-books/due/run", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
    assert.equal(providerReads, stoppedAt);
    snapshot = (await (await GET(new Request(endpoint, { headers }))).json()).data;
    assert.equal((await action({ action: "ERASE", revision: snapshot.connection.revision, confirmation: "DELETE_OBSERVATIONS" })).status, 200);
    assert.equal((await (await GET(new Request(endpoint, { headers }))).json()).data.total, 0);
  } finally {
    context.mock.restoreAll();
    await pool.query("delete from workspaces where id=$1", [workspaceId]);
    await pool.query("delete from users where id=$1", [ownerId]);
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
