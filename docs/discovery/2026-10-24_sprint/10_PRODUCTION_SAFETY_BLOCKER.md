# Production safety blocker

**Status: open. Do not send real bills to the public site. Do not patch during this sprint.**

Inspection: 2026-10-24, source only, plus the prior session's recorded live check. This sprint sent **no** request to `https://www.vognary.com/api/audit` or any other production mutation endpoint.

## What source does

**FACT.** `src/app/api/audit/route.ts` calls `rejectUnclearedFinancialRequest` when the body contains receipt text, statement sources, or manual items. That helper (`src/lib/server/financial-intake.ts`) returns HTTP 403 `FINANCIAL_INTAKE_LOCKED` unless the caller is a session in an enrolled workspace. A body that is only `{"fixture":"SUPPLIER_BILL_DEMO_V1"}` is the fixed demo and returns `mode: "fixed-synthetic-demo"`.

The same lock is on `POST /api/ingest`, `POST /api/receipt-image/propose`, and `POST /api/workspaces/current/ask`.

**FACT.** Local tests on 2026-10-24, Node v22.23.2, `NODE_ENV=test`: `tests/audit-route.test.ts` and `tests/financial-intake.test.ts` — 27 passed, 0 failed. Guest receipt text is refused before cards are derived.

**FACT.** `src/app/start/start-client.tsx` still invites "Upload or paste a bill" and "Or paste the receipt". The public `/security` page, read on 2026-10-24 in the prior session, says real customer financial data stays blocked until an independent assessment. Those two sentences cannot both be the operating rule while `/start` posts financial text to `/api/audit`.

**FACT.** Payment collection is not "on" in source by default. `src/lib/pilot-payment-link.ts` stays unavailable unless mode, URL, and a verification JSON all match the ₹14,999 offer. `/pay` shows "ONLINE COLLECTION NOT CONFIGURED" in that state. No env value was read out.

## What production did, and what this sprint did not recheck

**Prior observation, 2026-10-24, recorded in** [`01_AS_BUILT_VS_AS_PROMISED.md`](../../strategy/vognary_2026-10-24/01_AS_BUILT_VS_AS_PROMISED.md). An anonymous POST to `https://www.vognary.com/api/audit` with one synthetic receipt line returned HTTP 200, `mode: "stateless-audit-api"`, `storage: "none"`. The fixed-fixture body also returned `stateless-audit-api`, which current source would not do.

**UNKNOWN today.** The deployed git SHA, whether that behaviour is still live, whether the process stored the body in logs, and whether an Anthropic key is configured on the guest ingest path. This sprint did not repeat the request, did not open the host dashboard, and did not read production logs.

**INFERENCE.** If that observation is still true, production is not the tree at `3604496`. CONTINUE-HERE on 2026-09-09 already said a Vercel deployment had failed and the live copy differed from source. That note was not re-proven against a SHA this week.

## Risk

If the live audit route still accepts anonymous text, a visitor who follows `/start` can submit bill contents to a server that advertises a data block. The prior response said `storage: "none"`. That is not a workspace write. It does not prove the text missed logs, a vendor model, or a crash dump. Treating the site as safe for a customer's invoice would be false.

Interviews in this sprint stay on words and ranges. No upload. No "try it on your OpenAI invoice."

## Remediation, for a later explicit approval

Not authorised now. Smallest later change, if the founder orders it:

1. Confirm the deployed SHA. If it is behind `3604496`, the fix is a deploy of the existing lock, not a new feature.
2. After deploy, a **separate** check may send the fixed fixture and one synthetic line from a machine that is allowed to test production. Expect 200 only for the fixture mode `fixed-synthetic-demo`, and 403 for receipt text. Do not use a real bill for that check.
3. Change `/start` so it no longer asks a stranger to paste a bill, or point it only at the fixed fixture. That is a copy change and needs its own okay.
4. Leave Razorpay, schema, and Zoho alone in that deploy.

Until steps 1 and 2 have a written result, the pilot protocol uses synthetic or redacted material in a local or demo workspace only.

## What this sprint did not do

No patch, no migration, no deploy, no production payload, no customer file, no payment configuration.
