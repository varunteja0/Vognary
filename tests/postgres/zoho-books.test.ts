import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import { createZohoBooksClient } from "../../src/lib/server/zoho-books-client";
import { createZohoBooksService } from "../../src/lib/server/zoho-books-store";
import { getDatabasePool } from "../../src/lib/server/database";
import { createAccessExportRequest, downloadAccessExport } from "../../src/lib/server/privacy-lifecycle-store";
import { isZohoBooksState } from "../../src/lib/zoho-books/contracts";

const fixtureBill = {
  bill_id: "200001", vendor_id: "300001", vendor_name: "Synthetic lifecycle vendor", bill_number: "SYNTHETIC-LIFECYCLE",
  date: "2026-09-01", currency_code: "INR", status: "open", total: 123.45, balance: 123.45,
  last_modified_time: "2026-09-01T00:00:00+0530",
};

async function withSourceFixture(
  respond: (url: URL) => Response | Promise<Response>,
  run: (input: { service: ReturnType<typeof createZohoBooksService>; workspaceId: string; ownerId: string; connect: (now: Date) => Promise<void> }) => Promise<void>,
  configure?: (ownerId: string) => Partial<Parameters<typeof createZohoBooksService>[0]>,
) {
  const pool = getDatabasePool();
  const ownerId = randomUUID();
  const workspaceId = randomUUID();
  await pool.query("insert into users (id,email) values ($1,$2)", [ownerId, `zoho-lifecycle-${ownerId}@example.test`]);
  await pool.query("insert into workspaces (id,owner_user_id,name) values ($1,$2,'Synthetic lifecycle workspace')", [workspaceId, ownerId]);
  await pool.query("insert into workspace_members (workspace_id,user_id,role) values ($1,$2,'owner')", [workspaceId, ownerId]);
  const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
  const provider = createZohoBooksClient({ clientId: "synthetic", clientSecret: "synthetic", redirectUri: "http://127.0.0.1:3037/callback" }, async input => {
    const url = new URL(input);
    if (url.pathname === "/oauth/v2/token") return json({ access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_in: 3600, api_domain: "https://www.zohoapis.in" });
    if (url.pathname === "/oauth/v2/token/revoke") return json({ status: "success" });
    if (url.pathname.endsWith("/organizations")) return json({ code: 0, organizations: [{ organization_id: "100001", name: "Synthetic organization", currency_code: "INR", is_org_active: true }] });
    return respond(url);
  });
  const service = createZohoBooksService({ client: provider, pool, workspaceIds: [workspaceId], ...configure?.(ownerId) });
  const connect = async (now: Date) => {
    const authorization = await service.begin(workspaceId, ownerId, now);
    await service.complete(workspaceId, ownerId, new URL(authorization.authorizationUrl).searchParams.get("state")!, "synthetic-code", now);
    const snapshot = await service.read(workspaceId, ownerId);
    await service.select(workspaceId, ownerId, "100001", snapshot.connection!.revision, now);
  };
  try {
    await run({ service, workspaceId, ownerId, connect });
  } finally {
    await pool.query("delete from workspaces where id=$1", [workspaceId]);
    await pool.query("delete from users where id=$1", [ownerId]);
  }
}

test("imported baselines remain unreviewed without creating attention and explicit follow-ups remain visible", { skip: !process.env.DATABASE_URL }, async () => {
  let total = 123.45;
  await withSourceFixture(() => Response.json({ code: 0, bills: [{ ...fixtureBill, total }], page_context: { page: 1, has_more_page: false } }), async ({ service, workspaceId, ownerId, connect }) => {
    await connect(new Date("2026-09-06T00:00:00.000Z"));
    await service.runDue(new Date("2026-09-06T00:00:00.000Z"));
    assert.equal((await service.read(workspaceId, ownerId, { view: "ATTENTION" })).total, 0);
    const baseline = (await service.read(workspaceId, ownerId, { view: "ALL" })).items[0];
    assert.equal(baseline.changeKind, "BASELINE");
    assert.equal(baseline.disposition, null);
    assert.equal((await getDatabasePool().query("select sequence from zoho_books_reviews where workspace_id=$1", [workspaceId])).rowCount, 0);
    await service.disposition(workspaceId, ownerId, { billId: baseline.bill.billId, sourceSequence: baseline.sequence, expectedLatestSequence: baseline.sequence, expectedVersion: "0", idempotencyKey: `synthetic-baseline-${randomUUID()}`, kind: "FOLLOW_UP", note: "Synthetic imported bill needs clarification", followUpOn: "2026-12-01" }, new Date("2026-09-06T01:00:00.000Z"));
    assert.equal((await service.read(workspaceId, ownerId, { view: "ATTENTION" })).total, 1);
    total = 130;
    await service.runDue(new Date("2026-09-07T00:00:00.000Z"));
    const amended = (await service.read(workspaceId, ownerId, { view: "ATTENTION" })).items[0];
    assert.equal(amended.changeKind, "AMENDED");
    assert.equal(amended.disposition, null);
    assert.equal(amended.openFollowUpCount, 1);
  });
});

test("routine status and balance revisions stay in history without creating review tasks", { skip: !process.env.DATABASE_URL }, async () => {
  let current = { ...fixtureBill };
  await withSourceFixture(() => Response.json({ code: 0, bills: [current], page_context: { page: 1, has_more_page: false } }), async ({ service, workspaceId, ownerId, connect }) => {
    await connect(new Date("2026-09-06T00:00:00.000Z"));
    await service.runDue(new Date("2026-09-06T00:00:00.000Z"));
    current = { ...current, status: "paid", balance: 0, last_modified_time: "2026-09-07T00:00:00+0530" };
    await service.runDue(new Date("2026-09-07T00:00:00.000Z"));
    for (const sort of [undefined, "UPDATED"] as const) {
      assert.equal((await service.read(workspaceId, ownerId, { view: "ATTENTION", sort })).total, 0);
      const all = await service.read(workspaceId, ownerId, { view: "ALL", sort });
      assert.equal(all.total, 1);
      assert.equal(all.items[0].changeKind, "AMENDED");
      assert.equal(all.items[0].disposition, null);
    }
    const detail = await service.detail(workspaceId, ownerId, fixtureBill.bill_id);
    assert.equal(detail.observations.length, 2);
    assert.equal(detail.current.previous?.totalMinor, detail.current.bill.totalMinor);
    assert.equal(detail.current.bill.balanceMinor, "0");
    assert.equal(detail.events.length, 0);
    assert.equal((await getDatabasePool().query("select sequence from zoho_books_reviews where workspace_id=$1", [workspaceId])).rowCount, 0);
  });
});

test("an informational update preserves an unanswered material review until its explicit closure", { skip: !process.env.DATABASE_URL }, async () => {
  let current = { ...fixtureBill };
  await withSourceFixture(() => Response.json({ code: 0, bills: [current], page_context: { page: 1, has_more_page: false } }), async ({ service, workspaceId, ownerId, connect }) => {
    await connect(new Date("2026-09-06T00:00:00.000Z"));
    await service.runDue(new Date("2026-09-06T00:00:00.000Z"));
    current = { ...current, total: 130, balance: 130, last_modified_time: "2026-09-07T00:00:00+0530" };
    await service.runDue(new Date("2026-09-07T00:00:00.000Z"));
    const question = (await service.detail(workspaceId, ownerId, fixtureBill.bill_id)).current;
    current = { ...current, status: "paid", balance: 0, last_modified_time: "2026-09-08T00:00:00+0530" };
    await service.runDue(new Date("2026-09-08T00:00:00.000Z"));
    const attention = await service.read(workspaceId, ownerId, { view: "ATTENTION", sort: "UPDATED" });
    assert.equal(attention.total, 1);
    assert.equal(attention.items[0].pendingReviewSequence, question.sequence);
    assert.equal(attention.items[0].pendingReviewCount, 1);
    await service.disposition(workspaceId, ownerId, { billId: fixtureBill.bill_id, sourceSequence: question.sequence, expectedLatestSequence: attention.items[0].sequence, expectedVersion: "0", idempotencyKey: `synthetic-routine-close-${randomUUID()}`, kind: "RESOLVED", note: "Synthetic prior amount question answered", followUpOn: null }, new Date("2026-09-08T01:00:00.000Z"));
    assert.equal((await service.read(workspaceId, ownerId, { view: "ATTENTION", sort: "UPDATED" })).total, 0);
    assert.equal((await service.read(workspaceId, ownerId, { view: "RESOLVED", sort: "UPDATED" })).total, 1);
    const returning = await service.detail(workspaceId, ownerId, fixtureBill.bill_id);
    assert.equal(returning.observations.length, 3);
    assert.equal(returning.current.disposition, null);
    assert.equal(returning.events.length, 1);
  });
});

test("attention relevance keeps material combinations and inconsistent balances actionable", { skip: !process.env.DATABASE_URL }, async () => {
  const cases = [
    { name: "unchanged", before: {}, after: {}, attention: false },
    { name: "overdue", before: {}, after: { status: "overdue" }, attention: false },
    { name: "partial", before: {}, after: { status: "partially_paid", balance: 60 }, attention: false },
    { name: "partial reduction", before: { status: "partially_paid", balance: 60 }, after: { balance: 30 }, attention: false },
    { name: "paid", before: {}, after: { status: "paid", balance: 0 }, attention: false },
    { name: "overdue paid", before: { status: "overdue" }, after: { status: "paid", balance: 0 }, attention: false },
    { name: "partial paid", before: { status: "partially_paid", balance: 60 }, after: { status: "paid", balance: 0 }, attention: false },
    { name: "amount", before: {}, after: { total: 130, balance: 130 }, attention: true },
    { name: "amount decrease", before: {}, after: { total: 100, balance: 100 }, attention: true },
    { name: "currency", before: {}, after: { currency_code: "USD" }, attention: true },
    { name: "supplier identifier", before: {}, after: { vendor_id: "300002" }, attention: true },
    { name: "supplier name", before: {}, after: { vendor_name: "Synthetic renamed supplier" }, attention: true },
    { name: "number", before: {}, after: { bill_number: "SYNTHETIC-RENUMBERED" }, attention: true },
    { name: "date", before: {}, after: { date: "2026-09-02" }, attention: true },
    { name: "balance increase", before: { status: "partially_paid", balance: 60 }, after: { balance: 90 }, attention: true },
    { name: "open reduction", before: {}, after: { balance: 60 }, attention: true },
    { name: "paid balance inconsistent", before: {}, after: { status: "paid", balance: 30 }, attention: true },
    { name: "prior balance inconsistent", before: { balance: 200 }, after: { status: "paid", balance: 0 }, attention: true },
    { name: "approval", before: { status: "pending_approval" }, after: { status: "approved" }, attention: true },
    { name: "paid reversal", before: { status: "paid", balance: 0 }, after: { status: "open", balance: 123.45 }, attention: true },
    { name: "overdue reversal", before: { status: "overdue" }, after: { status: "open" }, attention: true },
    { name: "void", before: {}, after: { status: "void", balance: 0 }, attention: true },
    { name: "amount and paid", before: {}, after: { total: 130, status: "paid", balance: 0 }, attention: true },
    { name: "currency and paid", before: {}, after: { currency_code: "USD", status: "paid", balance: 0 }, attention: true },
    { name: "supplier and overdue", before: {}, after: { vendor_id: "300002", status: "overdue" }, attention: true },
  ];
  let changed = false;
  await withSourceFixture(() => Response.json({ code: 0, bills: cases.map((scenario, index) => ({ ...fixtureBill, bill_id: String(700000 + index), ...scenario.before, ...(changed ? scenario.after : {}), last_modified_time: changed ? "2026-09-07T00:00:00+0530" : fixtureBill.last_modified_time })), page_context: { page: 1, has_more_page: false } }), async ({ service, workspaceId, ownerId, connect }) => {
    await connect(new Date("2026-09-06T00:00:00.000Z"));
    await service.runDue(new Date("2026-09-06T00:00:00.000Z"));
    changed = true;
    await service.runDue(new Date("2026-09-07T00:00:00.000Z"));
    for (const sort of [undefined, "UPDATED"] as const) {
      const page = await service.read(workspaceId, ownerId, { view: "ATTENTION", sort });
      for (const [index, scenario] of cases.entries()) assert.equal(page.items.some(item => item.bill.billId === String(700000 + index)), scenario.attention, scenario.name);
      assert.equal(page.total, cases.filter(scenario => scenario.attention).length);
    }
    assert.equal((await service.read(workspaceId, ownerId, { view: "ALL" })).total, cases.length);
    assert.equal((await getDatabasePool().query("select id from zoho_books_dispositions where workspace_id=$1", [workspaceId])).rowCount, 0);
  });
});

test("available-record overview survives empty, partial and unchanged first imports and filtered return visits", { skip: !process.env.DATABASE_URL }, async () => {
  let mode = "empty";
  await withSourceFixture(url => {
    const page = Number(url.searchParams.get("page"));
    return Response.json({ code: 0, bills: mode === "empty" ? [] : [{ ...fixtureBill, bill_id: String(800000 + page), vendor_name: `Synthetic baseline ${page}` }], page_context: { page, has_more_page: mode === "partial" } });
  }, async ({ service, workspaceId, ownerId, connect }) => {
    const unconnected = await service.read(workspaceId, ownerId, { sort: "UPDATED" });
    assert.equal(unconnected.overview?.billCount, 0);
    assert.equal(unconnected.connection, null);
    await connect(new Date("2026-09-06T00:00:00.000Z"));
    const queued = await service.read(workspaceId, ownerId, { sort: "UPDATED" });
    assert.equal(queued.connection?.lastSuccessfulSyncAt, null);
    mode = "partial";
    await service.runDue(new Date("2026-09-06T00:00:00.000Z"));
    const partial = await service.read(workspaceId, ownerId, { view: "ATTENTION", sort: "UPDATED" });
    assert.ok(partial.overview!.billCount > 0);
    assert.equal(partial.total, 0);
    assert.equal(partial.connection?.lastSuccessfulSyncAt, null);
    mode = "complete";
    await service.runDue(new Date("2026-09-06T00:01:00.000Z"));
    const complete = await service.read(workspaceId, ownerId, { view: "ATTENTION", sort: "UPDATED" });
    assert.equal(complete.connection?.status, "READY");
    assert.equal(complete.overview?.needsReviewCount, 0);
    assert.equal(complete.overview?.changedBillCount, 0);
    assert.equal(complete.overview?.oldestPendingObservedAt, null);
    await service.runDue(new Date("2026-09-07T00:01:00.000Z"));
    const returning = await service.read(workspaceId, ownerId, { view: "ATTENTION", sort: "UPDATED", search: "no match" });
    assert.deepEqual(returning.overview, complete.overview);
    assert.equal(returning.total, 0);
    assert.notEqual(returning.connection?.lastSuccessfulSyncAt, complete.connection?.lastSuccessfulSyncAt);
    assert.equal(isZohoBooksState(returning), true);
  });
  await withSourceFixture(() => Response.json({ code: 0, bills: [], page_context: { page: 1, has_more_page: false } }), async ({ service, workspaceId, ownerId, connect }) => {
    await connect(new Date("2026-09-06T00:00:00.000Z"));
    await service.runDue(new Date("2026-09-06T00:00:00.000Z"));
    const empty = await service.read(workspaceId, ownerId, { sort: "UPDATED" });
    assert.equal(empty.overview?.billCount, 0);
    assert.equal(empty.connection?.status, "READY");
    assert.ok(empty.connection?.lastSuccessfulSyncAt);
  });
});

test("a changed bill during an incomplete initial import is not another baseline", { skip: !process.env.DATABASE_URL }, async () => {
  let changed = false;
  await withSourceFixture(url => Response.json({ code: 0, bills: [{ ...fixtureBill, total: changed ? 130 : 123.45, balance: changed ? 130 : 123.45, last_modified_time: changed ? "2026-09-07T00:00:00+0530" : fixtureBill.last_modified_time }], page_context: { page: Number(url.searchParams.get("page")), has_more_page: !changed } }), async ({ service, workspaceId, ownerId, connect }) => {
    await connect(new Date("2026-09-06T00:00:00.000Z"));
    await service.runDue(new Date("2026-09-06T00:00:00.000Z"), { maxSteps: 1 });
    assert.equal((await service.read(workspaceId, ownerId)).connection?.lastSuccessfulSyncAt, null);
    changed = true;
    await service.runDue(new Date("2026-09-07T00:00:00.000Z"));
    const review = await service.read(workspaceId, ownerId, { view: "ATTENTION", sort: "UPDATED" });
    assert.equal(review.total, 1);
    assert.equal(review.items[0].changeKind, "AMENDED");
    assert.equal(review.items[0].previous?.totalMinor, "12345");
    assert.equal(review.items[0].bill.totalMinor, "13000");
  });
});

test("confirmed-removal fixtures and restoration stay material and routine updates retain a follow-up", { skip: !process.env.DATABASE_URL }, async () => {
  let current = { ...fixtureBill };
  await withSourceFixture(() => Response.json({ code: 0, bills: [current], page_context: { page: 1, has_more_page: false } }), async ({ service, workspaceId, ownerId, connect }) => {
    await connect(new Date("2026-09-06T00:00:00.000Z"));
    await service.runDue(new Date("2026-09-06T00:00:00.000Z"));
    const original = (await service.detail(workspaceId, ownerId, fixtureBill.bill_id)).current;
    await service.disposition(workspaceId, ownerId, { billId: fixtureBill.bill_id, sourceSequence: original.sequence, expectedLatestSequence: original.sequence, expectedVersion: "0", idempotencyKey: `synthetic-followup-retained-${randomUUID()}`, kind: "FOLLOW_UP", note: "Synthetic clarification remains outstanding", followUpOn: "2026-12-01" }, new Date("2026-09-06T01:00:00.000Z"));
    current = { ...current, status: "paid", balance: 0, last_modified_time: "2026-09-07T00:00:00+0530" };
    await service.runDue(new Date("2026-09-07T00:00:00.000Z"));
    const informational = await service.read(workspaceId, ownerId, { view: "ATTENTION", sort: "UPDATED" });
    assert.equal(informational.total, 1);
    assert.equal(informational.items[0].reviewRelevance, "INFORMATIONAL");
    assert.equal(informational.items[0].openFollowUpCount, 1);
    const pool = getDatabasePool();
    const removal = (await pool.query("insert into zoho_books_snapshots (connection_id,workspace_id,bill_id,fingerprint,bill,change_kind,observed_at) select connection_id,workspace_id,bill_id,$2,bill,'REMOVED',$3 from zoho_books_snapshots where sequence=$1 returning sequence", [informational.items[0].sequence, `synthetic-confirmed-removal-${randomUUID()}`, "2026-09-07T01:00:00.000Z"])).rows[0];
    await pool.query("update zoho_books_records set latest_sequence=$2,deleted=true where workspace_id=$1", [workspaceId, removal.sequence]);
    const removed = await service.read(workspaceId, ownerId, { view: "ATTENTION", sort: "UPDATED" });
    assert.equal(removed.items[0].reviewRelevance, "MATERIAL");
    assert.equal(removed.items[0].bill.totalMinor, "12345");
    await service.runDue(new Date("2026-09-08T00:00:00.000Z"));
    const restored = await service.detail(workspaceId, ownerId, fixtureBill.bill_id);
    assert.equal(restored.current.previousChangeKind, "REMOVED");
    assert.equal(restored.current.reviewRelevance, "MATERIAL");
    assert.equal(restored.current.pendingReviewCount, 2);
    assert.equal(restored.openFollowUps.length, 1);
  });
});

test("bill register searches and sorts hundreds of exact-currency records with stable bounded pages", { skip: !process.env.DATABASE_URL }, async () => {
  const bills = Array.from({ length: 340 }, (_, index) => ({ ...fixtureBill, bill_id: String(500000 + index), vendor_name: `Synthetic supplier ${String(index).padStart(3, "0")}`, bill_number: `SYN-${index}`, currency_code: index % 2 ? "USD" : "INR", total: Number((index + 1.01).toFixed(2)), balance: Number((index + 1.01).toFixed(2)) }));
  bills[0].vendor_name = "Synthetic 100%_literal supplier";
  await withSourceFixture(url => {
    const page = Number(url.searchParams.get("page"));
    const size = Number(url.searchParams.get("per_page"));
    return Response.json({ code: 0, bills: bills.slice((page - 1) * size, page * size), page_context: { page, has_more_page: page * size < bills.length } });
  }, async ({ service, workspaceId, ownerId, connect }) => {
    await connect(new Date("2026-09-06T00:00:00.000Z"));
    for (let minute = 0; minute < 3; minute += 1) await service.runDue(new Date(Date.parse("2026-09-06T00:00:00.000Z") + minute * 60_000));
    const options = { view: "ALL" as const, sort: "SUPPLIER" as const, search: "Synthetic" };
    const first = await service.read(workspaceId, ownerId, options);
    assert.equal(first.total, 340);
    assert.equal(first.items.length, 50);
    assert.equal(first.items[0].bill.vendorName, "Synthetic 100%_literal supplier");
    assert.ok(first.nextCursor);
    const sequences = first.items.map(item => item.sequence);
    const literal = await service.read(workspaceId, ownerId, { ...options, search: "%_literal" });
    assert.equal(literal.total, 1);
    assert.equal((await service.read(workspaceId, ownerId, { ...options, search: "missing synthetic supplier" })).total, 0);
    bills[100].vendor_name = "Synthetic AAA amended supplier";
    for (let minute = 0; minute < 3; minute += 1) await service.runDue(new Date(Date.parse("2026-09-07T00:03:00.000Z") + minute * 60_000));
    let cursor: string | null = first.nextCursor;
    while (cursor) {
      const page = await service.read(workspaceId, ownerId, { ...options, cursor });
      assert.ok(page.items.length <= 50);
      assert.equal(page.total, 340);
      assert.equal(page.throughSequence, first.throughSequence);
      assert.ok(page.items.every(item => item.bill.vendorName !== "Synthetic AAA amended supplier"));
      sequences.push(...page.items.map(item => item.sequence));
      cursor = page.nextCursor;
    }
    assert.equal(sequences.length, 340);
    assert.equal(new Set(sequences).size, 340);
    const money = await service.read(workspaceId, ownerId, { view: "ALL", sort: "AMOUNT_DESC", currency: "INR" });
    assert.equal(money.total, 170);
    assert.equal(money.items[0].bill.totalMinor, "33901");
    assert.ok(money.items.every(item => item.bill.currency === "INR"));
    assert.ok(money.items.every((item, index) => index === 0 || BigInt(money.items[index - 1].bill.totalMinor) >= BigInt(item.bill.totalMinor)));
    assert.equal(isZohoBooksState(first), true);
    await assert.rejects(service.read(workspaceId, ownerId, { ...options, search: "changed query", cursor: first.nextCursor }), { code: "INVALID_EVIDENCE" });
    await assert.rejects(service.read(workspaceId, randomUUID(), options), { code: "FORBIDDEN" });
  });
});

test("review cannot acknowledge an amendment committed after the displayed page was read", {
  skip: !process.env.DATABASE_URL,
}, async () => {
  let total = 123.45;
  await withSourceFixture(() => new Response(JSON.stringify({ code: 0, bills: [{ ...fixtureBill, total }], page_context: { page: 1, has_more_page: false } })), async ({ service, workspaceId, ownerId, connect }) => {
    await connect(new Date("2026-09-06T00:00:00.000Z"));
    await service.runDue(new Date("2026-09-06T00:00:00.000Z"));
    total = 130;
    await service.runDue(new Date("2026-09-07T00:00:00.000Z"));
    const pool = getDatabasePool();
    let interleave = true;
    const readingPool = new Proxy(pool, {
      get(target, property) {
        if (property === "connect") return async () => {
          const client = await target.connect();
          return new Proxy(client, {
            get(connection, field) {
              if (field === "query") return async (...args: unknown[]) => {
                const result = await Reflect.apply(connection.query, connection, args);
                if (interleave && result.fields?.some((field: { name: string }) => field.name === "bill") && result.fields?.some((field: { name: string }) => field.name === "sequence")) {
                  interleave = false;
                  total = 140;
                  await service.runDue(new Date("2026-09-08T00:00:00.000Z"));
                }
                return result;
              };
              const value = Reflect.get(connection, field);
              return typeof value === "function" ? value.bind(connection) : value;
            },
          });
        };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const readingService = createZohoBooksService({ client: null, pool: readingPool });
    const displayed = await readingService.read(workspaceId, ownerId, { changesOnly: true });
    assert.equal(interleave, false);
    assert.equal(displayed.items[0].bill.totalMinor, "13000");
    await service.review(workspaceId, ownerId, displayed.items.map(item => item.sequence), displayed.connection!.revision);
    const remaining = await service.read(workspaceId, ownerId, { changesOnly: true });
    assert.equal(remaining.items.length, 1, "The unseen amendment must remain in attention.");
    assert.equal(remaining.items[0].bill.totalMinor, "14000");
  });
});

test("exact review preserves unseen pages and amendments arriving between pages", {
  skip: !process.env.DATABASE_URL,
}, async () => {
  let total = 123.45;
  await withSourceFixture(() => Response.json({ code: 0, bills: Array.from({ length: 53 }, (_, index) => ({ ...fixtureBill, bill_id: String(200001 + index), total })), page_context: { page: 1, has_more_page: false } }), async ({ service, workspaceId, ownerId, connect }) => {
    await connect(new Date("2026-09-06T00:00:00.000Z"));
    await service.runDue(new Date("2026-09-06T00:00:00.000Z"));
    total = 130;
    await service.runDue(new Date("2026-09-07T00:00:00.000Z"));
    const first = await service.read(workspaceId, ownerId, { changesOnly: true });
    assert.equal(first.items.length, 50);
    assert.ok(first.nextCursor);
    await service.review(workspaceId, ownerId, first.items.map(item => item.sequence), first.connection!.revision);
    const second = await service.read(workspaceId, ownerId, { changesOnly: true, cursor: first.nextCursor });
    assert.equal(second.items.length, 3);
    total = 140;
    await service.runDue(new Date("2026-09-08T00:00:00.000Z"));
    await service.review(workspaceId, ownerId, second.items.map(item => item.sequence), second.connection!.revision);
    const next = await service.read(workspaceId, ownerId, { changesOnly: true });
    assert.equal(next.total, 53);
    assert.ok(next.items.every(item => item.bill.totalMinor === "14000"));
    await assert.rejects(service.review(workspaceId, ownerId, ["9223372036854775807"], next.connection!.revision), { code: "NOT_FOUND" });
    await assert.rejects(service.review(workspaceId, ownerId, [next.items[0].sequence], first.connection!.revision), { code: "STALE_STATE" });
  });
});

test("concurrent reviewers acknowledge exact workspace observations and reject stale connections", {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const adminId = randomUUID();
  const pool = getDatabasePool();
  await pool.query("insert into users (id,email) values ($1,$2)", [adminId, `synthetic-reviewer-${adminId}@example.test`]);
  let total = 123.45;
  try {
    await withSourceFixture(() => Response.json({ code: 0, bills: [{ ...fixtureBill, total }], page_context: { page: 1, has_more_page: false } }), async ({ service, workspaceId, ownerId, connect }) => {
      await pool.query("insert into workspace_members (workspace_id,user_id,role) values ($1,$2,'admin')", [workspaceId, adminId]);
      await connect(new Date("2026-09-06T00:00:00.000Z"));
      await service.runDue(new Date("2026-09-06T00:00:00.000Z"));
      total = 130;
      await service.runDue(new Date("2026-09-07T00:00:00.000Z"));
      const observed = await service.read(workspaceId, ownerId, { changesOnly: true });
      const results = await Promise.allSettled([ownerId, adminId].map(userId => service.review(workspaceId, userId, [observed.items[0].sequence], observed.connection!.revision)));
      assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
      const rejected = results.find(result => result.status === "rejected");
      assert.equal(rejected?.reason.code, "STALE_STATE");
      assert.equal((await service.read(workspaceId, adminId, { changesOnly: true })).total, 0);
      total = 140;
      await service.runDue(new Date("2026-09-08T00:00:00.000Z"));
      const latest = await service.read(workspaceId, adminId, { changesOnly: true });
      assert.equal(latest.items.length, 1);
      await service.review(workspaceId, adminId, [observed.items[0].sequence], latest.connection!.revision);
      assert.equal((await service.read(workspaceId, ownerId, { changesOnly: true })).total, 1);
      const reviews = await pool.query("select reviewed_by_user_id from zoho_books_reviews where workspace_id=$1", [workspaceId]);
      assert.equal(reviews.rowCount, 1);
      assert.ok([ownerId, adminId].includes(reviews.rows[0].reviewed_by_user_id));
    });
  } finally {
    await pool.query("delete from users where id=$1", [adminId]);
  }
});

test("terminal outage delivers an operator incident and audited resume preserves history and freshness", { skip: !process.env.DATABASE_URL }, async () => {
  const received: Array<Record<string, unknown>> = [];
  const receiver = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    received.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    response.writeHead(200);
    response.end();
  });
  await new Promise<void>(resolve => receiver.listen(0, "127.0.0.1", resolve));
  const address = receiver.address();
  assert.ok(address && typeof address !== "string");
  let unavailable = false;
  let total = 123.45;
  let reads = 0;
  try {
    await withSourceFixture(() => {
      reads += 1;
      return unavailable ? Response.json({ code: 1000 }, { status: 503 }) : Response.json({ code: 0, bills: [{ ...fixtureBill, total }], page_context: { page: 1, has_more_page: false } });
    }, async ({ service, workspaceId, ownerId, connect }) => {
      await connect(new Date("2026-09-06T00:00:00.000Z"));
      await service.runDue(new Date("2026-09-06T00:00:00.000Z"));
      const initial = await service.read(workspaceId, ownerId);
      unavailable = true;
      for (let attempt = 0; attempt < 5; attempt += 1) await service.runDue(new Date(Date.parse("2026-09-07T00:00:00.000Z") + attempt * 3_600_000));
      const failed = await service.read(workspaceId, ownerId);
      assert.equal(failed.connection?.status, "FAILED");
      assert.equal(received.length, 1, "The designated operator sink must receive the terminal incident.");
      assert.equal(received[0].assignedOperatorUserId, ownerId);
      assert.doesNotMatch(JSON.stringify(received), /synthetic-access|synthetic-refresh|totalMinor|vendorName/);
      assert.equal(failed.connection?.incident?.deliveryStatus, "DELIVERED");
      assert.equal(isZohoBooksState(failed), true);
      assert.equal(isZohoBooksState({ ...failed, connection: { ...failed.connection, incident: { ...failed.connection?.incident, canResume: "yes" } } }), false);
      unavailable = false;
      total = 130;
      const beforeResume = reads;
      await service.runDue(new Date("2026-09-08T00:00:00.000Z"));
      assert.equal(reads, beforeResume);
      await assert.rejects(service.resume(workspaceId, randomUUID(), failed.connection!.incident!.id, failed.connection!.revision, new Date("2026-09-08T00:00:00.000Z")), { code: "FORBIDDEN" });
      const configuration = { ZOHO_BOOKS_CLIENT_ID: "synthetic", ZOHO_BOOKS_CLIENT_SECRET: "synthetic", ZOHO_BOOKS_PILOT_WORKSPACE_IDS: workspaceId, ZOHO_BOOKS_OPERATOR_USER_ID: ownerId, NEXT_PUBLIC_APP_URL: "http://localhost" };
      const savedEnvironment = Object.fromEntries(Object.keys(configuration).map(key => [key, process.env[key]]));
      Object.assign(process.env, configuration);
      try {
        const { POST } = await import("../../src/app/api/workspaces/current/sources/zoho-books/route");
        const { createSessionCookie } = await import("../../src/lib/server/session");
        const cookie = await createSessionCookie({ userId: ownerId, workspaceId });
        const resumed = await POST(new Request("http://localhost/api/workspaces/current/sources/zoho-books", { method: "POST", headers: { cookie: `${cookie.name}=${encodeURIComponent(cookie.value)}`, origin: "http://localhost", "content-type": "application/json", "X-Vognary-Workspace": workspaceId }, body: JSON.stringify({ action: "RESUME", incidentId: failed.connection!.incident!.id, revision: failed.connection!.revision }) }));
        assert.equal(resumed.status, 200);
      } finally {
        for (const [key, value] of Object.entries(savedEnvironment)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
      const queued = await service.read(workspaceId, ownerId);
      assert.equal(queued.connection?.status, "QUEUED");
      assert.equal(queued.connection?.lastSuccessfulSyncAt, initial.connection?.lastSuccessfulSyncAt);
      await service.runDue(new Date("2026-09-08T00:00:00.000Z"));
      await service.runDue(new Date("2026-09-08T01:00:00.000Z"));
      const recovered = await service.read(workspaceId, ownerId);
      assert.equal(recovered.connection?.status, "READY");
      assert.equal(recovered.items[0].bill.totalMinor, "13000");
      assert.equal(recovered.connection?.lastSuccessfulSyncAt, "2026-09-08T00:00:00.000Z");
      assert.equal((await getDatabasePool().query("select sequence from zoho_books_snapshots where workspace_id=$1", [workspaceId])).rowCount, 2);
      assert.equal((await getDatabasePool().query("select id from audit_log where workspace_id=$1 and action='zoho-books.recovery.resumed'", [workspaceId])).rowCount, 1);
      const exportRequest = await createAccessExportRequest({ workspaceId, actorUserId: ownerId });
      const exported = await downloadAccessExport({ requestId: exportRequest.id, workspaceId, actorUserId: ownerId });
      assert.ok("serialized" in exported);
      const incident = JSON.parse(exported.serialized).zohoBooks.incidents[0];
      assert.equal(incident.resumedByUserId, ownerId);
      assert.equal(incident.deliveryStatus, "DELIVERED");
      assert.ok(incident.recoveredAt);
    }, ownerId => ({ operatorUserId: ownerId, deliverIncident: async incident => {
      const response = await fetch(`http://127.0.0.1:${address.port}`, { method: "POST", body: JSON.stringify(incident) });
      return { status: response.ok ? "delivered" : "failed", backend: "sentry", eventId: incident.id };
    } }));
  } finally {
    await new Promise<void>((resolve, reject) => receiver.close(error => error ? reject(error) : resolve()));
  }
});

test("an unassigned incident can be claimed and redelivered only by the configured operator", { skip: !process.env.DATABASE_URL }, async () => {
  await withSourceFixture(() => Response.json({ code: 1000 }, { status: 503 }), async ({ service, workspaceId, ownerId, connect }) => {
    await connect(new Date("2026-09-06T00:00:00.000Z"));
    for (let attempt = 0; attempt < 5; attempt += 1) await service.runDue(new Date(Date.parse("2026-09-06T00:00:00.000Z") + attempt * 3_600_000));
    const state = await service.read(workspaceId, ownerId);
    assert.equal(state.connection?.incident?.assignedOperatorUserId, null);
    let notices = 0;
    const operator = createZohoBooksService({ client: null, workspaceIds: [workspaceId], operatorUserId: ownerId, deliverIncident: async incident => { notices += 1; return { status: "delivered", backend: "sentry", eventId: incident.id }; } });
    await assert.rejects(service.escalate(workspaceId, ownerId, state.connection!.incident!.id, state.connection!.revision), { code: "FORBIDDEN" });
    await operator.escalate(workspaceId, ownerId, state.connection!.incident!.id, state.connection!.revision);
    assert.equal(notices, 1);
    const assigned = await operator.read(workspaceId, ownerId);
    assert.equal(assigned.connection?.status, "FAILED");
    assert.equal(assigned.connection?.incident?.assignedOperatorUserId, ownerId);
    assert.equal(assigned.connection?.incident?.deliveryStatus, "DELIVERED");
    assert.equal((await getDatabasePool().query("select id from audit_log where workspace_id=$1 and action='zoho-books.recovery.operator-assigned'", [workspaceId])).rowCount, 1);
  });
});

test("a new consent generation receives a new terminal incident", { skip: !process.env.DATABASE_URL }, async () => {
  await withSourceFixture(() => Response.json({ code: 0, bills: [{}] }), async ({ service, workspaceId, ownerId, connect }) => {
    await connect(new Date("2026-09-06T00:00:00.000Z"));
    await service.runDue(new Date("2026-09-06T00:00:00.000Z"));
    const first = await service.read(workspaceId, ownerId);
    await connect(new Date("2026-09-07T00:00:00.000Z"));
    await service.runDue(new Date("2026-09-07T00:00:00.000Z"));
    const next = await service.read(workspaceId, ownerId);
    assert.notEqual(next.connection?.incident?.id, first.connection?.incident?.id);
    assert.equal(next.connection?.incident?.deliveryStatus, "UNCONFIGURED");
    assert.equal(next.connection?.incident?.canResume, false);
  });
});

for (const failure of ["schema", "revoked"] as const) {
  test(`operator resume refuses ${failure} failures`, { skip: !process.env.DATABASE_URL }, async () => {
    let failed = false;
    await withSourceFixture(() => failed ? failure === "schema" ? Response.json({ code: 0, bills: [{}] }) : Response.json({ code: 57 }, { status: 403 }) : Response.json({ code: 0, bills: [fixtureBill], page_context: { page: 1, has_more_page: false } }), async ({ service, workspaceId, ownerId, connect }) => {
      await connect(new Date("2026-09-06T00:00:00.000Z"));
      await service.runDue(new Date("2026-09-06T00:00:00.000Z"));
      failed = true;
      await service.runDue(new Date("2026-09-07T00:00:00.000Z"));
      const state = await service.read(workspaceId, ownerId);
      assert.ok(state.connection?.incident);
      await assert.rejects(service.resume(workspaceId, ownerId, state.connection.incident.id, state.connection.revision), { code: "FORBIDDEN" });
    }, ownerId => ({ operatorUserId: ownerId, deliverIncident: async incident => ({ status: "delivered", backend: "sentry", eventId: incident.id }) }));
  });
}

test("bill review identities reveal only current same-workspace display names and retain audit IDs", { skip: !process.env.DATABASE_URL }, async () => {
  const pool = getDatabasePool();
  const readerId = randomUUID();
  await pool.query("insert into users (id,email,display_name) values ($1,$2,'Synthetic reader')", [readerId, `synthetic-reader-${readerId}@example.test`]);
  try {
    await withSourceFixture(() => Response.json({ code: 0, bills: [fixtureBill], page_context: { page: 1, has_more_page: false } }), async ({ service, workspaceId, ownerId, connect }) => {
      await pool.query("update users set display_name='Synthetic finance owner' where id=$1", [ownerId]);
      await pool.query("insert into workspace_members (workspace_id,user_id,role) values ($1,$2,'member')", [workspaceId, readerId]);
      await connect(new Date("2026-09-06T00:00:00.000Z"));
      await service.runDue(new Date("2026-09-06T00:00:00.000Z"));
      const first = await service.detail(workspaceId, ownerId, "200001");
      await service.disposition(workspaceId, ownerId, { billId: "200001", sourceSequence: first.current.sequence, expectedLatestSequence: first.current.sequence, expectedVersion: "0", idempotencyKey: `synthetic-name-${randomUUID()}`, kind: "FOLLOW_UP", note: "Synthetic question", followUpOn: "2026-12-01" }, new Date("2026-09-06T01:00:00.000Z"));
      const detail = await service.detail(workspaceId, readerId, "200001");
      assert.equal(detail.viewerUserId, readerId);
      assert.deepEqual(detail.people, [{ userId: ownerId, displayName: "Synthetic finance owner" }]);
      assert.equal(detail.events[0].actorUserId, ownerId);
      const register = await service.read(workspaceId, readerId, { view: "FOLLOW_UP", sort: "UPDATED" });
      assert.equal(register.items[0].responsibleUserId, ownerId);
      assert.deepEqual(register.people, detail.people);
      assert.doesNotMatch(JSON.stringify(detail), /@example\.test/);
      await pool.query("delete from workspace_members where workspace_id=$1 and user_id=$2", [workspaceId, ownerId]);
      const after = await service.detail(workspaceId, readerId, "200001");
      assert.deepEqual(after.people, []);
      assert.equal(after.events[0].actorUserId, ownerId);
    });
  } finally { await pool.query("delete from users where id=$1", [readerId]); }
});

test("bill change disposition survives replay, follow-up, resolution, return and a new amendment", { skip: !process.env.DATABASE_URL }, async () => {
  let total = 123.45;
  await withSourceFixture(() => Response.json({ code: 0, bills: [{ ...fixtureBill, total }], page_context: { page: 1, has_more_page: false } }), async ({ service, workspaceId, ownerId, connect }) => {
    await connect(new Date("2026-09-06T00:00:00.000Z"));
    await service.runDue(new Date("2026-09-06T00:00:00.000Z"));
    total = 130;
    await service.runDue(new Date("2026-09-07T00:00:00.000Z"));
    const first = await service.detail(workspaceId, ownerId, "200001");
    assert.equal(first.current.bill.totalMinor, "13000");
    assert.equal(first.current.previous?.totalMinor, "12345");
    const request = { billId: "200001", sourceSequence: first.current.sequence, expectedLatestSequence: first.current.sequence, expectedVersion: "0", idempotencyKey: `synthetic-followup-${randomUUID()}`, kind: "FOLLOW_UP", note: "Synthetic supplier explanation is still needed.", followUpOn: "2026-09-10" };
    await getDatabasePool().query("update workspace_members set role='member' where workspace_id=$1 and user_id=$2", [workspaceId, ownerId]);
    assert.equal((await service.detail(workspaceId, ownerId, "200001")).canManage, false);
    await assert.rejects(service.disposition(workspaceId, ownerId, request), { code: "FORBIDDEN" });
    await getDatabasePool().query("update workspace_members set role='owner' where workspace_id=$1 and user_id=$2", [workspaceId, ownerId]);
    const followUp = await service.disposition(workspaceId, ownerId, request, new Date("2026-09-07T01:00:00.000Z"));
    assert.equal(followUp.kind, "FOLLOW_UP");
    assert.equal(followUp.responsibleUserId, ownerId);
    assert.equal(followUp.basis, "HUMAN_REVIEW_NOT_PAYMENT");
    assert.deepEqual(await service.disposition(workspaceId, ownerId, request, new Date("2026-09-12T00:00:00.000Z")), followUp);
    await assert.rejects(service.disposition(workspaceId, ownerId, { ...request, note: "Different synthetic explanation" }), { code: "CONFLICT" });
    assert.equal((await service.read(workspaceId, ownerId, { view: "FOLLOW_UP" })).total, 1);
    const close = { ...request, expectedVersion: "1", idempotencyKey: `synthetic-resolution-${randomUUID()}`, kind: "RESOLVED", note: "Synthetic supplier confirmed the revised amount; review closed, no payment asserted.", followUpOn: null };
    await service.disposition(workspaceId, ownerId, close, new Date("2026-09-08T00:00:00.000Z"));
    const returning = createZohoBooksService({ client: null });
    const closed = await returning.detail(workspaceId, ownerId, "200001");
    assert.equal(closed.current.disposition?.kind, "RESOLVED");
    assert.equal(closed.events.length, 2);
    assert.equal((await returning.read(workspaceId, ownerId, { view: "ATTENTION" })).total, 0);
    total = 140;
    await service.runDue(new Date("2026-09-09T00:00:00.000Z"));
    const next = await returning.detail(workspaceId, ownerId, "200001");
    assert.equal(next.current.disposition, null);
    assert.equal(next.events.length, 2);
    const historical = await returning.detail(workspaceId, ownerId, "200001", { sequence: first.current.sequence });
    assert.equal(historical.selected.sequence, first.current.sequence);
    assert.equal(historical.selected.disposition?.kind, "RESOLVED");
    assert.equal(historical.current.sequence, next.current.sequence);
    assert.equal((await returning.read(workspaceId, ownerId, { view: "ATTENTION" })).total, 1);
    await assert.rejects(service.disposition(workspaceId, ownerId, { ...close, idempotencyKey: `synthetic-stale-${randomUUID()}`, expectedVersion: "2" }), { code: "STALE_STATE" });
    await assert.rejects(returning.detail(workspaceId, randomUUID(), "200001"), { code: "FORBIDDEN" });
    const latest = { ...close, sourceSequence: next.current.sequence, expectedLatestSequence: next.current.sequence, expectedVersion: "0" };
    const concurrent = await Promise.allSettled([1, 2].map(index => service.disposition(workspaceId, ownerId, { ...latest, idempotencyKey: `synthetic-concurrent-${index}-${randomUUID()}` }, new Date("2026-09-09T01:00:00.000Z"))));
    assert.equal(concurrent.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(concurrent.find(result => result.status === "rejected")?.reason.code, "STALE_STATE");
    const stored = await getDatabasePool().query("select id from zoho_books_dispositions where workspace_id=$1", [workspaceId]);
    assert.equal(stored.rowCount, 3);
    await assert.rejects(getDatabasePool().query("update zoho_books_dispositions set note='rewritten' where workspace_id=$1", [workspaceId]));
    const exportRequest = await createAccessExportRequest({ workspaceId, actorUserId: ownerId });
    const exported = await downloadAccessExport({ requestId: exportRequest.id, workspaceId, actorUserId: ownerId });
    assert.ok("serialized" in exported);
    const dispositions = JSON.parse(exported.serialized).zohoBooks.dispositions;
    assert.equal(dispositions.length, 3);
    assert.equal(dispositions[0].basis, "HUMAN_REVIEW_NOT_PAYMENT");
    assert.equal(dispositions[0].actorUserId, ownerId);
  });
});

test("a new bill revision retains an earlier outstanding follow-up until explicitly closed", { skip: !process.env.DATABASE_URL }, async () => {
  let total = 123.45;
  await withSourceFixture(() => Response.json({ code: 0, bills: [{ ...fixtureBill, total }], page_context: { page: 1, has_more_page: false } }), async ({ service, workspaceId, ownerId, connect }) => {
    await connect(new Date("2026-09-06T00:00:00.000Z"));
    await service.runDue(new Date("2026-09-06T00:00:00.000Z"));
    const first = await service.detail(workspaceId, ownerId, "200001");
    const pending = { billId: "200001", sourceSequence: first.current.sequence, expectedLatestSequence: first.current.sequence, expectedVersion: "0", idempotencyKey: `synthetic-carry-${randomUUID()}`, kind: "FOLLOW_UP", note: "Synthetic clarification pending", followUpOn: "2026-09-10" };
    await service.disposition(workspaceId, ownerId, pending, new Date("2026-09-06T01:00:00.000Z"));
    total = 140;
    await service.runDue(new Date("2026-09-07T00:00:00.000Z"));
    const amended = await service.detail(workspaceId, ownerId, "200001");
    assert.equal(amended.openFollowUps.length, 1);
    await service.disposition(workspaceId, ownerId, { ...pending, sourceSequence: amended.current.sequence, expectedLatestSequence: amended.current.sequence, kind: "RESOLVED", note: "Latest synthetic change explained", followUpOn: null, idempotencyKey: `synthetic-latest-${randomUUID()}` });
    assert.equal((await service.read(workspaceId, ownerId, { view: "FOLLOW_UP" })).total, 1);
    await service.disposition(workspaceId, ownerId, { ...pending, expectedLatestSequence: amended.current.sequence, expectedVersion: "1", kind: "RESOLVED", note: "Earlier synthetic question answered", followUpOn: null, idempotencyKey: `synthetic-earlier-${randomUUID()}` });
    assert.equal((await service.read(workspaceId, ownerId, { view: "ATTENTION" })).total, 0);
  });
});

test("long bill histories remain fully pageable and source erasure removes every disposition", { skip: !process.env.DATABASE_URL }, async () => {
  let total = 120;
  await withSourceFixture(() => Response.json({ code: 0, bills: [{ ...fixtureBill, total }], page_context: { page: 1, has_more_page: false } }), async ({ service, workspaceId, ownerId, connect }) => {
    await connect(new Date("2026-09-06T00:00:00.000Z"));
    await service.runDue(new Date("2026-09-06T00:00:00.000Z"));
    const first = await service.detail(workspaceId, ownerId, "200001");
    for (let index = 0; index < 55; index += 1) {
      await service.disposition(workspaceId, ownerId, { billId: "200001", sourceSequence: first.current.sequence, expectedLatestSequence: first.current.sequence, expectedVersion: String(index), idempotencyKey: `synthetic-history-${index}-${randomUUID()}`, kind: "RESOLVED", note: `Synthetic explanation revision ${index + 1}`, followUpOn: null });
    }
    const recent = await service.detail(workspaceId, ownerId, "200001");
    assert.equal(recent.events.length, 50);
    assert.ok(recent.nextEventCursor);
    const older = await service.detail(workspaceId, ownerId, "200001", { eventCursor: recent.nextEventCursor });
    assert.equal(older.events.length, 5);
    assert.equal(older.nextEventCursor, null);
    assert.equal(new Set([...recent.events, ...older.events].map(item => item.id)).size, 55);
    total = 130;
    await service.runDue(new Date("2026-09-07T00:00:00.000Z"));
    const amended = await service.detail(workspaceId, ownerId, "200001");
    const past = await service.detail(workspaceId, ownerId, "200001", { cursor: amended.current.sequence, sequence: first.current.sequence });
    assert.equal(past.observations.length, 1);
    assert.equal(past.selected.disposition?.version, "55");
    await service.disconnect(workspaceId, ownerId, amended.connectionRevision);
    const revoked = await service.read(workspaceId, ownerId);
    await service.erase(workspaceId, ownerId, revoked.connection!.revision);
    for (const table of ["zoho_books_snapshots", "zoho_books_reviews", "zoho_books_incidents", "zoho_books_dispositions"]) {
      assert.equal((await getDatabasePool().query(`select count(*)::int as count from ${table} where workspace_id=$1`, [workspaceId])).rows[0].count, 0);
    }
  });
});

test("a multi-day import resumes from its starting watermark, not its finish time", {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const watermarks: Array<string | null> = [];
  await withSourceFixture(url => {
    watermarks.push(url.searchParams.get("last_modified_time"));
    const page = Number(url.searchParams.get("page"));
    return new Response(JSON.stringify({ code: 0, bills: page === 1 ? [fixtureBill] : [], page_context: { page, has_more_page: page === 1 } }));
  }, async ({ service, connect }) => {
    const start = new Date("2026-09-06T00:00:00.000Z");
    await connect(start);
    await service.runDue(start, { maxSteps: 1 });
    await service.runDue(new Date("2026-09-10T00:00:00.000Z"), { maxSteps: 1 });
    await service.runDue(new Date("2026-09-11T01:00:00.000Z"), { maxSteps: 1 });
    assert.equal(watermarks.at(-1), "2026-09-05T00:00:00.000Z");
  });
});

test("unconfirmed missing bills retain history until the provider returns the bill again", {
  skip: !process.env.DATABASE_URL,
}, async () => {
  let missing = false;
  const watermarks: Array<string | null> = [];
  await withSourceFixture(url => {
    if (url.pathname.endsWith("/200001")) return new Response(JSON.stringify({ code: 1002 }), { status: 404 });
    watermarks.push(url.searchParams.get("last_modified_time"));
    return new Response(JSON.stringify({ code: 0, bills: missing ? [] : [fixtureBill], page_context: { page: 1, has_more_page: false } }));
  }, async ({ service, workspaceId, ownerId, connect }) => {
    await connect(new Date("2026-09-06T00:00:00.000Z"));
    await service.runDue(new Date("2026-09-06T00:00:00.000Z"));
    missing = true;
    await service.runDue(new Date("2026-09-14T00:00:00.000Z"));
    const uncertain = await service.read(workspaceId, ownerId);
    assert.equal(uncertain.items[0].changeKind, "BASELINE");
    assert.equal(uncertain.connection?.failureCode, "ABSENCE_UNCONFIRMED");
    assert.equal(uncertain.connection?.status, "FAILED");
    missing = false;
    await connect(new Date("2026-09-15T00:00:00.000Z"));
    await service.runDue(new Date("2026-09-15T01:00:00.000Z"));
    const restored = await service.read(workspaceId, ownerId);
    assert.notEqual(restored.items[0].sequence, uncertain.items[0].sequence);
    assert.deepEqual(restored.items[0].bill, uncertain.items[0].bill);
    const history = await service.detail(workspaceId, ownerId, fixtureBill.bill_id);
    assert.deepEqual(history.observations.find(observation => observation.sequence === uncertain.items[0].sequence)?.bill, uncertain.items[0].bill);
    const bindings = (await getDatabasePool().query("select grant_id from zoho_books_snapshots where workspace_id=$1 order by sequence", [workspaceId])).rows;
    assert.equal(bindings.length, 2);
    assert.notEqual(bindings[0].grant_id, bindings[1].grant_id);
    await service.runDue(new Date("2026-09-16T02:00:00.000Z"));
    assert.notEqual(watermarks.at(-1), null);
  });
});

for (const scenario of [
  { name: "unrelated JSON 404", response: () => Response.json({ error: "upstream_route_unavailable" }, { status: 404 }), code: "ABSENCE_UNCONFIRMED" },
  { name: "undocumented bill error", response: () => Response.json({ code: 1002 }, { status: 404 }), code: "ABSENCE_UNCONFIRMED" },
  { name: "malformed error", response: () => new Response("not-json", { status: 404 }), code: "SCHEMA_CHANGED" },
  { name: "permission loss", response: () => Response.json({ code: 57 }, { status: 403 }), code: "REAUTH_REQUIRED" },
  { name: "provider outage", response: () => Response.json({ code: 1000 }, { status: 503 }), code: "PROVIDER_UNAVAILABLE" },
  { name: "network failure", response: () => { throw new Error("Synthetic connection failure"); }, code: "PROVIDER_UNAVAILABLE" },
]) {
  test(`full scan preserves the prior bill on ${scenario.name}`, { skip: !process.env.DATABASE_URL }, async () => {
    let scanning = false;
    await withSourceFixture(url => url.pathname.endsWith("/200001") ? scenario.response() : Response.json({ code: 0, bills: scanning ? [] : [fixtureBill], page_context: { page: 1, has_more_page: false } }), async ({ service, workspaceId, ownerId, connect }) => {
      await connect(new Date("2026-09-06T00:00:00.000Z"));
      await service.runDue(new Date("2026-09-06T00:00:00.000Z"));
      const before = await service.read(workspaceId, ownerId);
      scanning = true;
      const result = await service.runDue(new Date("2026-09-14T00:00:00.000Z"));
      const after = await service.read(workspaceId, ownerId);
      assert.equal(result.failures[0]?.code, scenario.code);
      assert.deepEqual(after.items, before.items);
      assert.equal(after.connection?.lastSuccessfulSyncAt, before.connection?.lastSuccessfulSyncAt);
      const stored = await getDatabasePool().query("select deleted from zoho_books_records where workspace_id=$1", [workspaceId]);
      assert.equal(stored.rows[0].deleted, false);
    });
  });
}

test("database source constraints refuse financial snapshots with missing required amounts", {
  skip: !process.env.DATABASE_URL,
}, async () => {
  await withSourceFixture(() => new Response(JSON.stringify({ code: 0, bills: [], page_context: { page: 1, has_more_page: false } })), async ({ service, workspaceId, ownerId, connect }) => {
    await connect(new Date("2026-09-06T00:00:00.000Z"));
    const source = await service.read(workspaceId, ownerId);
    await assert.rejects(getDatabasePool().query(
      "insert into zoho_books_snapshots (connection_id,workspace_id,bill_id,fingerprint,bill,change_kind,observed_at) values ($1,$2,'999999','synthetic-malformed',$3,'BASELINE',now())",
      [source.connection!.id, workspaceId, { billId: "999999", basis: "PROVIDER_BILL_TOTAL" }],
    ));
  });
});

test("provider throttling, permission loss and restored consent keep previous observations intact", {
  skip: !process.env.DATABASE_URL,
}, async () => {
  let mode: "ok" | "throttled" | "denied" = "ok";
  await withSourceFixture(() => {
    if (mode === "throttled") return new Response(JSON.stringify({ code: 44 }), { status: 429, headers: { "retry-after": "120" } });
    if (mode === "denied") return new Response(JSON.stringify({ code: 57 }), { status: 403 });
    return new Response(JSON.stringify({ code: 0, bills: [fixtureBill], page_context: { page: 1, has_more_page: false } }));
  }, async ({ service, workspaceId, ownerId, connect }) => {
    await connect(new Date("2026-09-06T00:00:00.000Z"));
    await service.runDue(new Date("2026-09-06T00:00:00.000Z"));
    const initial = await service.read(workspaceId, ownerId);
    const encrypted = await getDatabasePool().query("select access_secret,refresh_secret from zoho_books_connections where workspace_id=$1", [workspaceId]);
    assert.doesNotMatch(JSON.stringify(encrypted.rows), /synthetic-access|synthetic-refresh/);
    mode = "throttled";
    await service.runDue(new Date("2026-09-07T00:00:00.000Z"));
    const waiting = await service.read(workspaceId, ownerId);
    assert.equal(waiting.connection?.status, "RETRY_WAIT");
    assert.equal(waiting.connection?.lastSuccessfulSyncAt, initial.connection?.lastSuccessfulSyncAt);
    mode = "denied";
    await service.runDue(new Date("2026-09-07T01:00:00.000Z"));
    const denied = await service.read(workspaceId, ownerId);
    assert.equal(denied.connection?.status, "REAUTH_REQUIRED");
    assert.equal(denied.items[0]?.sequence, initial.items[0]?.sequence);
    mode = "ok";
    await connect(new Date("2026-09-07T02:00:00.000Z"));
    await service.runDue(new Date("2026-09-07T02:00:00.000Z"));
    assert.equal((await service.read(workspaceId, ownerId)).connection?.status, "READY");
    await assert.rejects(service.read(workspaceId, randomUUID()), { code: "FORBIDDEN" });
  });
});

test("removing the source authorizer's workspace authority stops unattended provider access", {
  skip: !process.env.DATABASE_URL,
}, async () => {
  let reads = 0;
  await withSourceFixture(() => {
    reads += 1;
    return new Response(JSON.stringify({ code: 0, bills: [fixtureBill], page_context: { page: 1, has_more_page: false } }));
  }, async ({ service, workspaceId, ownerId, connect }) => {
    await connect(new Date("2026-09-06T00:00:00.000Z"));
    await service.runDue(new Date("2026-09-06T00:00:00.000Z"));
    const before = reads;
    await getDatabasePool().query("update workspace_members set role='member' where workspace_id=$1 and user_id=$2", [workspaceId, ownerId]);
    await service.runDue(new Date("2026-09-07T00:00:00.000Z"));
    assert.equal(reads, before);
    assert.equal((await service.read(workspaceId, ownerId)).connection?.status, "REAUTH_REQUIRED");
  });
});

test("privacy export includes immutable Books observations without credential material", {
  skip: !process.env.DATABASE_URL,
}, async () => {
  await withSourceFixture(() => new Response(JSON.stringify({ code: 0, bills: [fixtureBill], page_context: { page: 1, has_more_page: false } })), async ({ service, workspaceId, ownerId, connect }) => {
    await connect(new Date("2026-09-06T00:00:00.000Z"));
    await service.runDue(new Date("2026-09-06T00:00:00.000Z"));
    const viewed = await service.read(workspaceId, ownerId);
    await service.review(workspaceId, ownerId, [viewed.items[0].sequence], viewed.connection!.revision);
    const request = await createAccessExportRequest({ workspaceId, actorUserId: ownerId });
    const exported = await downloadAccessExport({ requestId: request.id, workspaceId, actorUserId: ownerId });
    assert.equal(exported.status, "ok");
    assert.ok("serialized" in exported);
    const document = JSON.parse(exported.serialized);
    assert.equal(document.zohoBooks.snapshots[0].bill.totalMinor, "12345");
    assert.equal(document.zohoBooks.connections[0].organizationId, "100001");
    assert.equal(document.zohoBooks.records.length, 1);
    assert.equal(document.zohoBooks.reviews[0].sequence, viewed.items[0].sequence);
    assert.equal(document.zohoBooks.reviews[0].reviewedByUserId, ownerId);
    assert.ok(document.auditHistory.some((entry: { action: string }) => entry.action === "zoho-books.consent.authorized"));
    assert.ok(document.auditHistory.some((entry: { action: string }) => entry.action === "zoho-books.organization.selected"));
    assert.doesNotMatch(exported.serialized, /synthetic-access|synthetic-refresh|access_secret|refresh_secret|oauth_state_hash/);
  });
});

test("a reconnect without a new refresh token cannot inherit another authorization's credential", {
  skip: !process.env.DATABASE_URL,
}, async () => {
  await withSourceFixture(() => new Response(JSON.stringify({ code: 0, bills: [], page_context: { page: 1, has_more_page: false } })), async ({ workspaceId, ownerId, connect }) => {
    await connect(new Date("2026-09-06T00:00:00.000Z"));
    const provider = createZohoBooksClient({ clientId: "synthetic", clientSecret: "synthetic", redirectUri: "http://127.0.0.1:3037/callback" }, async input => new Response(JSON.stringify(new URL(input).pathname === "/oauth/v2/token"
      ? { access_token: "synthetic-new-access", expires_in: 3600, api_domain: "https://www.zohoapis.in" }
      : { code: 0, organizations: [{ organization_id: "999999", name: "Synthetic different organization", currency_code: "INR", is_org_active: true }] })));
    const service = createZohoBooksService({ client: provider });
    const now = new Date("2026-09-07T00:00:00.000Z");
    const begin = await service.begin(workspaceId, ownerId, now);
    await assert.rejects(service.complete(workspaceId, ownerId, new URL(begin.authorizationUrl).searchParams.get("state")!, "synthetic-code", now), { code: "REAUTH_REQUIRED" });
    assert.equal((await service.read(workspaceId, ownerId)).connection?.status, "REAUTH_REQUIRED");
  });
});

test("a bill amended back to an earlier value still appends a later observation", {
  skip: !process.env.DATABASE_URL,
}, async () => {
  let total = 123.45;
  await withSourceFixture(() => new Response(JSON.stringify({ code: 0, bills: [{ ...fixtureBill, total }], page_context: { page: 1, has_more_page: false } })), async ({ service, workspaceId, ownerId, connect }) => {
    await connect(new Date("2026-09-06T00:00:00.000Z"));
    await service.runDue(new Date("2026-09-06T00:00:00.000Z"));
    total = 130;
    await service.runDue(new Date("2026-09-07T00:00:00.000Z"));
    const amended = await service.read(workspaceId, ownerId);
    total = 123.45;
    await service.runDue(new Date("2026-09-08T00:00:00.000Z"));
    const restored = await service.read(workspaceId, ownerId);
    assert.equal(restored.items[0].changeKind, "AMENDED");
    assert.equal(restored.items[0].previous?.totalMinor, "13000");
    assert.ok(BigInt(restored.items[0].sequence) > BigInt(amended.items[0].sequence));
  });
});

test("Zoho observation lifecycle preserves exact revisions, checkpoints, authority and revocation", {
  skip: process.env.DATABASE_URL ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const ownerId = randomUUID();
  const memberId = randomUUID();
  const workspaceId = randomUUID();
  const suffix = randomUUID();
  await pool.query("insert into users (id,email) values ($1,$2),($3,$4)", [ownerId, `zoho-owner-${suffix}@example.test`, memberId, `zoho-member-${suffix}@example.test`]);
  await pool.query("insert into workspaces (id,owner_user_id,name) values ($1,$2,'Synthetic Books workspace')", [workspaceId, ownerId]);
  await pool.query("insert into workspace_members (workspace_id,user_id,role) values ($1,$2,'owner'),($1,$3,'member')", [workspaceId, ownerId, memberId]);
  const config = { clientId: "synthetic-client", clientSecret: "synthetic-secret", redirectUri: "http://127.0.0.1:3037/api/workspaces/current/sources/zoho-books/callback" };
  const start = new Date("2026-09-06T00:00:00.000Z");
  let changed = false;
  let calls = 0;
  const pages: string[] = [];
  const provider = createZohoBooksClient(config, async (input, init) => {
    calls += 1;
    const url = new URL(input);
    const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
    if (url.pathname === "/oauth/v2/token") return json({ access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_in: 3600, api_domain: "https://www.zohoapis.in" });
    if (url.pathname === "/oauth/v2/token/revoke") {
      assert.equal(init?.method, "POST");
      return json({ status: "success" });
    }
    if (url.pathname.endsWith("/organizations")) return json({ code: 0, organizations: [{ organization_id: "100001", name: "Synthetic Books organization", currency_code: "INR", is_org_active: true }] });
    if (url.pathname.endsWith("/bills")) {
      const page = url.searchParams.get("page")!;
      pages.push(page);
      const billId = page === "1" ? "200001" : "200002";
      return json({ code: 0, bills: [{
        bill_id: billId, vendor_id: "300001", vendor_name: "Synthetic Books vendor", bill_number: `SYNTHETIC-${billId}`,
        date: "2026-09-01", currency_code: "INR", status: "open",
        total: changed && page === "1" ? 130.01 : 123.45, balance: changed && page === "1" ? 130.01 : 123.45,
        last_modified_time: changed ? "2026-09-07T00:00:00+0530" : "2026-09-01T00:00:00+0530",
      }], page_context: { page: Number(page), has_more_page: page === "1" } });
    }
    throw new Error(`Unexpected synthetic provider path: ${url.pathname}`);
  });
  const service = createZohoBooksService({ client: provider, pool, workspaceIds: [workspaceId] });
  try {
    await assert.rejects(service.begin(workspaceId, memberId, start), { code: "FORBIDDEN" });
    const consent = await service.begin(workspaceId, ownerId, start);
    const state = new URL(consent.authorizationUrl).searchParams.get("state")!;
    await assert.rejects(service.complete(workspaceId, memberId, state, "synthetic-code", start), { code: "FORBIDDEN" });
    await service.complete(workspaceId, ownerId, state, "synthetic-code", start);
    await assert.rejects(service.complete(workspaceId, ownerId, state, "synthetic-code", start));
    const selection = await service.read(workspaceId, ownerId);
    assert.equal(selection.connection?.status, "AWAITING_ORGANIZATION");
    assert.equal(selection.organizations[0]?.id, "100001");
    await assert.rejects(service.select(workspaceId, ownerId, "999999", selection.connection!.revision, start));
    await service.select(workspaceId, ownerId, "100001", selection.connection!.revision, start);
    await service.runDue(start, { maxSteps: 1 });
    const partial = await service.read(workspaceId, ownerId);
    assert.equal(partial.connection?.status, "QUEUED");
    assert.equal(partial.connection?.lastSuccessfulSyncAt, null);
    assert.equal(partial.items.length, 1);
    await service.runDue(new Date(start.getTime() + 120_000), { maxSteps: 1 });
    const initial = await service.read(workspaceId, ownerId);
    assert.equal(initial.connection?.status, "READY");
    assert.equal(initial.total, 2);
    assert.deepEqual(pages, ["1", "2"]);
    assert.equal(initial.items[0]?.bill.totalMinor, "12345");
    changed = true;
    await service.runDue(new Date("2026-09-07T02:00:00.000Z"));
    const updated = await service.read(workspaceId, ownerId);
    const amended = updated.items.find(item => item.bill.billId === "200001")!;
    assert.equal(amended.bill.totalMinor, "13001");
    assert.equal(amended.previous?.totalMinor, "12345");
    assert.equal(amended.changeKind, "AMENDED");
    const snapshots = await pool.query("select sequence from zoho_books_snapshots where workspace_id=$1", [workspaceId]);
    assert.equal(snapshots.rowCount, 3);
    await assert.rejects(pool.query("update zoho_books_snapshots set bill= '{}'::jsonb where workspace_id=$1", [workspaceId]));
    await service.runDue(new Date("2026-09-08T02:00:00.000Z"));
    assert.equal((await pool.query("select sequence from zoho_books_snapshots where workspace_id=$1", [workspaceId])).rowCount, 3);
    const beforeRevoke = await service.read(workspaceId, ownerId);
    await service.disconnect(workspaceId, ownerId, beforeRevoke.connection!.revision);
    const callsAtRevoke = calls;
    await service.runDue(new Date("2026-09-09T02:00:00.000Z"));
    assert.equal(calls, callsAtRevoke);
    const revoked = await service.read(workspaceId, ownerId);
    assert.equal(revoked.connection?.status, "REVOKED");
    const secrets = await pool.query("select access_secret, refresh_secret from zoho_books_connections where workspace_id=$1", [workspaceId]);
    assert.equal(secrets.rows[0].access_secret, null);
    assert.equal(secrets.rows[0].refresh_secret, null);
    await service.erase(workspaceId, ownerId, revoked.connection!.revision);
    assert.equal((await service.read(workspaceId, ownerId)).total, 0);
  } finally {
    await pool.query("delete from workspaces where id=$1", [workspaceId]);
    await pool.query("delete from users where id = any($1::uuid[])", [[ownerId, memberId]]);
  }
});
