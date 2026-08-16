import { POST as recordActivation } from "../../src/app/api/workspaces/current/activation/route";
import { hasCitedRecurringSpendPicture } from "../../src/lib/recovery/domain";
import { recordConsentGrant } from "../../src/lib/server/consent-store";
import { getDatabasePool } from "../../src/lib/server/database";
import { getRecoveryHome, submitRecoveryEvidence } from "../../src/lib/server/recovery-store";
import { createSessionCookie } from "../../src/lib/server/session";

const baseUrl = "https://vognary.test";

async function main() {
  const workspaceId = process.argv[2]?.trim();
  const userId = process.argv[3]?.trim();
  const email = process.argv[4]?.trim();
  if (!workspaceId || !userId || !email) throw new Error("workspace id, user id, and email are required");

  await recordConsentGrant({
    workspaceId,
    userId,
    subjectEmail: email,
    purpose: "product-analytics-opt-in",
    noticeVersion: "privacy-2026-07-11",
    source: "activation-semantic-reset-test",
    scopes: ["privacy-safe-product-events"],
  });

  await submitRecoveryEvidence({
    workspaceId,
    actorUserId: userId,
    expectedVersion: 0,
    idempotencyKey: `activation-reset-${workspaceId}`,
    now: new Date("2026-08-09T10:00:00.000Z"),
    request: {
      kind: "RECEIPT_PASTE",
      receipts: [{
        clientRef: "activation-reset-openai",
        text: "OpenAI subscription charged INR 1,999 on 6 July 2026. Renews monthly on 6 August 2026.",
      }],
    },
  });

  const home = await getRecoveryHome({ workspaceId, actorUserId: userId });
  if (!hasCitedRecurringSpendPicture(home)) {
    throw new Error("qualified Home was not a cited recurring-spend picture");
  }

  const cookie = await createSessionCookie({ userId, workspaceId });
  const cookieHeader = `${cookie.name}=${encodeURIComponent(cookie.value)}`;
  const headers = {
    cookie: cookieHeader,
    origin: baseUrl,
    "content-type": "application/json",
  };

  const first = await recordActivation(new Request(`${baseUrl}/api/workspaces/current/activation`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      monthlyTotals: [{ amount: { currency: "INR", minor: "1", exponent: 2, display: "₹0.01" } }],
      activeCommitmentCount: 99,
    }),
  }));
  if (first.status !== 201) {
    throw new Error(`qualified activation path returned HTTP ${first.status}`);
  }
  const firstPayload = await first.json() as { data?: { recorded?: boolean } };
  if (!firstPayload.data?.recorded) throw new Error("qualified Home did not persist a workspace activation");

  const concurrent = await Promise.all(Array.from({ length: 8 }, () => recordActivation(new Request(`${baseUrl}/api/workspaces/current/activation`, {
    method: "POST",
    headers,
    body: "{}",
  }))));
  const concurrentStatuses = concurrent.map((response) => response.status);
  if (concurrentStatuses.some((status) => status !== 200)) {
    throw new Error(`concurrent activation replay statuses were ${concurrentStatuses.join(",")}`);
  }

  console.log(JSON.stringify({
    recorded: true,
    activeCommitmentCount: home.activeCommitmentCount,
    concurrentStatuses,
  }));
  await getDatabasePool().end();
}

void main();
