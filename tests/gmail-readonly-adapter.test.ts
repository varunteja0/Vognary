import assert from "node:assert/strict";
import test from "node:test";
import type { ConnectorSyncResult } from "../src/lib/connector-runtime";
import { ConnectorReauthorizationRequiredError } from "../src/lib/connector-errors";
import {
  decodeGmailBase64Url,
  extractGmailMessageText,
  gmailReadonlyAdapter,
} from "../src/lib/connectors/gmail-readonly-adapter";

test("decodes bounded base64url MIME and prefers inline plain text", () => {
  const plain = "OpenAI subscription receipt INR 1,999 renewal due 2026-09-10.";
  const html = "<p>HTML fallback should not replace plain text.</p>";
  const extracted = extractGmailMessageText({
    snippet: "snippet must not win",
    payload: {
      mimeType: "multipart/alternative",
      headers: [{ name: "Subject", value: "Your OpenAI receipt" }],
      parts: [
        { mimeType: "text/html", body: { data: encode(html), size: html.length } },
        { mimeType: "text/plain", body: { data: encode(plain), size: plain.length } },
      ],
    },
  });

  assert.match(extracted, /Your OpenAI receipt/);
  assert.match(extracted, /INR 1,999/);
  assert.doesNotMatch(extracted, /HTML fallback|snippet must not win/);
  assert.equal(decodeGmailBase64Url(encode("hello Gmail")), "hello Gmail");
  assert.equal(decodeGmailBase64Url("not valid ***"), null);
  assert.equal(decodeGmailBase64Url(encode("x".repeat(140 * 1_024))), null, "oversized decoded parts fail closed");
});

test("sanitizes HTML fallback and ignores attachment bodies", () => {
  const attachmentSecret = "ATTACHMENT_CONTENT_MUST_NOT_BE_READ";
  const html = "<style>.secret{display:block}</style><p>Netflix renewal &amp; receipt USD 15.99</p><script>steal()</script>";
  const extracted = extractGmailMessageText({
    payload: {
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "text/plain",
          filename: "private.txt",
          headers: [{ name: "Content-Disposition", value: "attachment; filename=private.txt" }],
          body: { data: encode(attachmentSecret), size: attachmentSecret.length },
        },
        { mimeType: "text/html", body: { data: encode(html), size: html.length } },
      ],
    },
  });

  assert.match(extracted, /Netflix renewal & receipt USD 15\.99/);
  assert.doesNotMatch(extracted, /ATTACHMENT_CONTENT|display:block|steal\(\)/);
  assert.doesNotMatch(extracted, /<[^>]+>/);
});

test("initial search paginates in bounded pages, continues, and never emits raw message text", async () => {
  let profileCalls = 0;
  const listTokens: Array<string | null> = [];
  const fullMessageUrls: string[] = [];
  const rawSecrets = ["PRIVATE_BODY_ALPHA", "PRIVATE_BODY_BETA", "PRIVATE_BODY_GAMMA"];

  await withMockFetch(async (input) => {
    const url = new URL(requestUrl(input));
    if (url.pathname.endsWith("/profile")) {
      profileCalls += 1;
      return json({ historyId: profileCalls === 1 ? "900" : "950" });
    }

    if (url.pathname.endsWith("/messages")) {
      const token = url.searchParams.get("pageToken");
      listTokens.push(token);
      assert.equal(url.searchParams.get("maxResults"), "50");
      if (!token) return json({ messages: [{ id: "m1" }], nextPageToken: "page-2" });
      if (token === "page-2") return json({ messages: [{ id: "m2" }], nextPageToken: "page-3" });
      if (token === "page-3") return json({ messages: [{ id: "m3" }] });
      throw new Error(`Unexpected list token: ${token}`);
    }

    const messageId = url.pathname.split("/").at(-1) ?? "";
    fullMessageUrls.push(url.toString());
    const index = Number(messageId.slice(1)) - 1;
    return json(fullMessage(messageId, `OpenAI subscription receipt INR ${1_000 + index} renewal due 2026-09-10. ${rawSecrets[index]}`));
  }, async () => {
    const first = asSyncResult(await gmailReadonlyAdapter.sync(connection()));
    assert.equal(first.continuation, true);
    assert.deepEqual(listTokens, [null, "page-2"], "one run reads at most two bounded search pages");
    assert.equal(first.nextCursorState?.gmailSearchPageToken, "page-3");
    assert.equal(first.nextCursorState?.gmailBackfillHistoryId, "900");
    assert.equal(first.coverage?.completeness, "partial");
    assert.deepEqual(first.evidence.map((item) => item.externalId).sort(), [
      "gmail-message:m1:receipt:0",
      "gmail-message:m2:receipt:0",
    ]);

    const serialized = JSON.stringify(first.evidence);
    for (const secret of rawSecrets) assert.equal(serialized.includes(secret), false);
    assert.equal(serialized.includes("evidenceText"), false);
    assert.equal(serialized.includes("payload"), false);

    const second = asSyncResult(await gmailReadonlyAdapter.sync(connection(), {
      cursorState: first.nextCursorState ?? {},
      startedAt: new Date().toISOString(),
    }));
    assert.equal(second.continuation, false);
    assert.equal(second.nextCursorState?.historyId, "900", "backfill advances only to the cursor captured before page one");
    assert.equal(second.nextCursorState?.gmailSearchPageToken, undefined);
    assert.equal(second.coverage?.completeness, "complete");
    assert.equal(second.evidence[0]?.externalId, "gmail-message:m3:receipt:0");
  });

  assert.ok(fullMessageUrls.every((url) => url.includes("format=full")));
  assert.equal(profileCalls, 2);
});

test("history cursor pagination is bounded and advances to the captured profile boundary", async () => {
  const historyTokens: Array<string | null> = [];

  await withMockFetch(async (input) => {
    const url = new URL(requestUrl(input));
    if (url.pathname.endsWith("/profile")) return json({ historyId: "950" });
    if (url.pathname.endsWith("/history")) {
      assert.equal(url.searchParams.get("startHistoryId"), "900");
      assert.equal(url.searchParams.get("maxResults"), "50");
      const token = url.searchParams.get("pageToken");
      historyTokens.push(token);
      if (!token) {
        return json({
          history: [{ messagesAdded: [{ message: { id: "h1" } }] }],
          historyId: "955",
          nextPageToken: "history-2",
        });
      }
      return json({
        history: [{ messagesAdded: [{ message: { id: "h2" } }, { message: { id: "h1" } }] }],
        historyId: "960",
      });
    }

    const messageId = url.pathname.split("/").at(-1) ?? "";
    return json(fullMessage(messageId, `Netflix subscription receipt USD 15.99 renewal due 2026-09-10. history-${messageId}`));
  }, async () => {
    const result = asSyncResult(await gmailReadonlyAdapter.sync(connection(), {
      cursorState: { historyId: "900", syncedAt: "2026-07-10T00:00:00.000Z" },
      startedAt: "2026-07-11T00:00:00.000Z",
    }));

    assert.deepEqual(historyTokens, [null, "history-2"]);
    assert.equal(result.continuation, false);
    assert.equal(result.nextCursorState?.historyId, "950", "mail arriving after the profile read is replayed next cycle, not skipped");
    assert.equal(result.coverage?.startAt, "2026-07-10T00:00:00.000Z");
    assert.equal(result.coverage?.completeness, "complete");
    assert.deepEqual(result.evidence.map((item) => item.externalId).sort(), [
      "gmail-message:h1:receipt:0",
      "gmail-message:h2:receipt:0",
    ]);
  });
});

test("an expired Gmail history cursor falls back to a bounded receipt backfill", async () => {
  const requestedPaths: string[] = [];

  await withMockFetch(async (input) => {
    const url = new URL(requestUrl(input));
    requestedPaths.push(url.pathname);
    if (url.pathname.endsWith("/profile")) return json({ historyId: "500" });
    if (url.pathname.endsWith("/history")) return new Response(null, { status: 404 });
    if (url.pathname.endsWith("/messages")) return json({ messages: [{ id: "fallback-1" }] });
    return json(fullMessage("fallback-1", "Airtel autopay bill INR 999 will be debited on 15/08/2026. FALLBACK_RAW_BODY"));
  }, async () => {
    const result = asSyncResult(await gmailReadonlyAdapter.sync(connection(), {
      cursorState: { historyId: "100", syncedAt: "2026-07-01T00:00:00.000Z" },
      startedAt: "2026-07-11T00:00:00.000Z",
    }));

    assert.ok(requestedPaths.some((path) => path.endsWith("/history")));
    assert.ok(requestedPaths.some((path) => path.endsWith("/messages")));
    assert.equal(result.continuation, false);
    assert.equal(result.nextCursorState?.historyId, "500");
    assert.equal(result.coverage?.completeness, "complete");
    assert.equal(result.evidence[0]?.merchantRaw, "Airtel");
    assert.equal(JSON.stringify(result.evidence).includes("FALLBACK_RAW_BODY"), false);
  });
});

test("classifies Google invalid_grant as a safe reauthorization requirement", async () => {
  await withGoogleOauthEnv(async () => {
    await withMockFetch(async (input) => {
      assert.equal(requestUrl(input), "https://oauth2.googleapis.com/token");
      return Response.json({
        error: "invalid_grant",
        error_description: "PROVIDER_DETAIL_MUST_NOT_LEAK",
      }, { status: 400 });
    }, async () => {
      await assert.rejects(
        gmailReadonlyAdapter.connect({
          ...connection(),
          accessToken: "expired-access-token",
          refreshToken: "revoked-refresh-token",
          expiresAt: "2020-01-01T00:00:00.000Z",
        }),
        (error) => {
          assert.ok(error instanceof ConnectorReauthorizationRequiredError);
          assert.equal(error.code, "connector_reauthorization_required");
          assert.equal(error.retryable, false);
          assert.match(error.message, /Reconnect Gmail/);
          assert.doesNotMatch(error.message, /PROVIDER_DETAIL|invalid_grant|revoked-refresh-token/);
          return true;
        },
      );
    });
  });
});

test("classifies Gmail API 401 and an expired access token without refresh as reauthorization", async () => {
  await withMockFetch(async () => (
    Response.json({ error: { message: "RAW_PROVIDER_AUTH_DETAIL" } }, { status: 401 })
  ), async () => {
    await assert.rejects(
      gmailReadonlyAdapter.sync(connection()),
      (error) => {
        assert.ok(error instanceof ConnectorReauthorizationRequiredError);
        assert.doesNotMatch(error.message, /RAW_PROVIDER_AUTH_DETAIL/);
        return true;
      },
    );
  });

  await assert.rejects(
    gmailReadonlyAdapter.connect({
      ...connection(),
      expiresAt: "2020-01-01T00:00:00.000Z",
    }),
    ConnectorReauthorizationRequiredError,
  );
});

function connection() {
  return {
    connectorId: "gmail-readonly",
    workspaceId: "00000000-0000-4000-8000-000000000001",
    accessToken: "gmail-access-token",
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
  };
}

function fullMessage(id: string, text: string) {
  return {
    id,
    internalDate: "1783728000000",
    snippet: "snippet is transient",
    payload: {
      mimeType: "multipart/alternative",
      headers: [{ name: "Subject", value: "Payment receipt" }],
      parts: [{ mimeType: "text/plain", body: { data: encode(text), size: text.length } }],
    },
  };
}

function encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function json(value: unknown) {
  return Response.json(value);
}

function requestUrl(input: RequestInfo | URL) {
  return typeof input === "string" || input instanceof URL ? input.toString() : input.url;
}

function asSyncResult(result: Awaited<ReturnType<typeof gmailReadonlyAdapter.sync>>): ConnectorSyncResult {
  assert.equal(Array.isArray(result), false);
  return result as ConnectorSyncResult;
}

async function withMockFetch(
  mock: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  run: () => Promise<void>,
) {
  const previous = globalThis.fetch;
  globalThis.fetch = mock as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = previous;
  }
}

async function withGoogleOauthEnv(run: () => Promise<void>) {
  const previousClientId = process.env.GOOGLE_CLIENT_ID;
  const previousClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
  try {
    await run();
  } finally {
    if (previousClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = previousClientId;
    if (previousClientSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
    else process.env.GOOGLE_CLIENT_SECRET = previousClientSecret;
  }
}
