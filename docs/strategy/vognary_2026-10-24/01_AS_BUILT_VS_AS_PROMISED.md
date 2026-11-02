# As built versus as promised — inspected 2026-10-24

Inspection scope: git `main` at `3604496af496891db5ecc68de29f602ea6fc775b` (2026-09-10, "fix: publish local launch repairs and lifecycle updates"), public pages on `https://www.vognary.com`, and read-only HTTP checks. No production database was opened. No secrets are recorded here. The August 2026 `audit-pack/` is historical; where it conflicts with this file, this file is the later observation.

Working tree on inspection: `main` matches `origin/main`. Untracked local directory `research/` is a prior strategy draft, not product code and not a company decision.

## How to read status

| Status | Meaning |
| --- | --- |
| IMPLEMENTED | Code on `main` does this, and a test or a live page shows it |
| PARTIAL | Real code, incomplete, env-gated, or not what the public sentence says |
| MOCK | Fixed synthetic data, labeled as such |
| MISSING | Described somewhere and not present as a working path |
| BROKEN | Observed contradiction or a known failing gate |
| NOT VERIFIED | Not checked in this review |

## Public site, 2026-10-24

Health: `GET /api/health` returned `{"service":"vognary-web","status":"ok","timestamp":"2026-10-24T08:51:30.023Z"}`.

| Route | HTTP | What a visitor gets |
| --- | --- | --- |
| `/` | 200 | Commitment Control desk. Synthetic model-API request of INR 4,80,000 against a INR 4,00,000 per-charge policy. Human authority. Link to `/pay` and `/start` |
| `/demo` | 200 | Synthetic decision. Sitemap `lastmod` 2026-09-04 |
| `/start` | 200 | "Upload or paste a bill." "Nothing is saved until you sign in." |
| `/pay` | 200 | One-time INR 14,999, no automatic renewal, up to 10 proposals, 4 weekly reviews, 2 extra founder hours. Banner: **ONLINE COLLECTION NOT CONFIGURED** |
| `/security` | 200 | Sessions, token vault, and Google sign-in: Configured. Retention schedule, renewal delivery, independent assessment, private-pilot collection: Not yet proven. Copy says real customer financial data stays blocked until assessment and retest |
| `/about`, `/privacy`, `/terms`, `/contact`, `/login` | 200 | Trust and account pages present |
| `/app` | 200 after redirect | Lands on `/login?next=/app` |
| `/api/checkout` | 410 | Retired assisted-audit checkout |
| `/api/readiness` | 401 | Internal route, closed |
| `/private-audit`, `/launch`, `/connect` | 308 | Redirect, consistent with README retirement |
| `POST /api/audit` | 200 | See the contradiction below |

Source of the commercial numbers: `src/lib/pilot-offer.ts` (`amountMinor: 1_499_900`, `termsVersion: "terms-2026-09-01"`, `proposalLimit: 10`). The live `/pay` page matches that offer and states collection is not configured.

## The live contradiction

**FACT.** On 2026-10-24 an anonymous `POST /api/audit` with `Origin: https://www.vognary.com` and one synthetic receipt line returned HTTP 200, `mode: "stateless-audit-api"`, `storage: "none"`. The same call with `{"fixture":"SUPPLIER_BILL_DEMO_V1"}` also returned `stateless-audit-api`, not the fixed-demo mode in current source.

**FACT.** Current `src/app/api/audit/route.ts` calls `rejectUnclearedFinancialRequest` when receipt text, sources, or manual items are present, and that helper returns 403 unless the caller is an enrolled workspace (`src/lib/server/financial-intake.ts`, `src/lib/commitment-control/enrollment.ts`). A fixed fixture is supposed to return `mode: "fixed-synthetic-demo"`.

**INFERENCE.** Production is not serving current `main` for this path. CONTINUE-HERE on 2026-09-09 already recorded a failed Vercel deployment and a live copy that differed from source. This review did not obtain the deployed git SHA. Treat local "launch repairs" as source, not as production behaviour.

**Why it matters.** `/security` tells a buyer that customer financial data is blocked. `/start` invites them to paste a bill. The audit endpoint still analyses anonymous text and declares that it did not store it. In-memory handling is not a workspace write. It is still intake, and it falsifies the public boundary. No pilot may ask anyone to paste a real bill until production matches the lock.

The probe used one invented line. It is not customer data. Do not repeat it.

## As-built versus as-promised

| Promise, from the live site or README | Repo / live status | Evidence |
| --- | --- | --- |
| Propose an obligation with purpose, vendor, amount, cadence, owner, intended outcome | IMPLEMENTED in domain code | `src/lib/commitment-control/contracts.ts`, `policy.ts`, `decision.ts`, `outcome.ts`. API: `POST /api/workspaces/current/control/proposals` |
| Policy annotates and never approves | IMPLEMENTED | `evaluateProposalPolicy` always sets `humanDecisionRequired: true`. Categories include `AI_MODEL`, `CLOUD_INFRASTRUCTURE`, `SOFTWARE`, `CONTRACTOR`, `CAMPAIGN`, `OTHER` |
| Owner or admin freezes a cap, caps lower, or declines | IMPLEMENTED | `DecideControlProposalRequest`. UI: `src/app/workspace/recovery/control/` |
| Cap stays frozen when a later bill arrives; verdict is matched, within cap, over cap, or cannot evaluate | IMPLEMENTED | `ControlReconciliationDto` verdicts in `contracts.ts`. Also `AUTHORIZATION_EXPIRED`, `CURRENCY_MISMATCH` |
| Outcome observations are user-entered, not proof | IMPLEMENTED | `observationBasis: "USER_ENTERED_OBSERVATION"`, verdict only `MET` or `MISSED` |
| Cited exposure from existing Recovery evidence | IMPLEMENTED as a code path | Exposure must cite evidence ids (`policy.ts`). Empty exposure is a reason code, not a guessed number |
| First session needs no bank or mailbox | PARTIAL | True for the designed loop. Live `/start` still asks for a bill paste. Gmail OAuth routes exist and README says they stay fail-closed |
| Private billing inbox can supply later receipts | PARTIAL | Inbound Resend webhook, alias, encryption, retention migrations `0023`–`0027`, `0048`. `/security` says receiving configuration is present and retention enforcement is not proven. This review did not send mail |
| Zoho Books bill snapshots can be compared with a gross cap | PARTIAL, not production-proven | Migrations `0070`–`0077`. README: local candidate, allowlist, no wildcard in production. Worker `GET/POST /api/internal/zoho-books/due/run`. `vercel.json` schedules it hourly |
| One-time ₹14,999 pilot can be paid online | MISSING on the deployment checked | Live `/pay` says collection is not configured. `/security` agrees. Historical Razorpay webhook code remains at `src/app/api/billing/webhooks/razorpay/route.ts` for old settlement, not as the live offer |
| Payment grants access to customer data | Correctly refused in source | Enrollment in production requires paid-workspace id **and** a cleared independent assessment (`enrollment.ts`). Assessment is "Not yet proven" on `/security` |
| Vognary does not auto-approve, purchase, provision, cancel, or move money | IMPLEMENTED as the Control rule | Public copy matches. Separate autopilot execution code exists and defaults off unless `AUTOPILOT_EXECUTION_ENABLED` is the literal string `true` (`src/lib/recovery/autopilot-switch.ts`). Do not turn it on |
| Direct provider connectors (AWS, OpenAI, Anthropic, Gmail, Setu) | DISABLED on the legacy route | `legacyConnectorRetirement.ts` returns 410. Adapter files still exist under `src/lib/connectors/`. They are not a launched product |
| Guest demo of fictional books inside `/app` | DISABLED by policy | README: `/app?demo=1` and `/app?guest=1` are 410. Not re-fetched in this review |
| Public checkout and assisted audit | DISABLED | Live `/api/checkout` is 410 |
| Independent security assessment before real data | NOT DONE | Live `/security`. No assessment report was in git. Do not invent one |
| Paid pilots, retention, active use | NOT VERIFIED after 2026-09-09, and recorded as zero before that | `docs/execution/scoreboard.md`. Private CRM was not opened |
| Production schema head | NOT VERIFIED | Repo migrations run through `0077_control_provider_bill_admission_guards`. CONTINUE-HERE on 2026-09-09 said a backup job saw production at `0056` while the profile required `0077`. No new database read was performed |
| Renewal-alert and retention crons | PARTIAL | Declared in `vercel.json`. Live `/security` says delivery and retention enforcement are not proven |
| AI cites or shuts up | IMPLEMENTED for signed-in reconstruction | Deterministic parser and policy. `/security` says an Anthropic key, if configured, can see guest document-ingest text. Whether that key is set in production: NOT VERIFIED. Env names were not printed |
| FinOps "capability grant" that could authorise a provider action | CODE PRESENT, not a product | `src/lib/finops-control/capability.ts` signs a short-lived grant after a human decision. No public page sells provider execution. Leave it unwired |

## What the repository actually is

**FACT.** One Next.js 16.3.4 application (`package.json`), React 19, PostgreSQL via `pg`, App Router under `src/app`. There is no separate backend service. Auth for production is Google OIDC. Development login exists and is hard-disabled when `NODE_ENV=production`. Magic link is env-gated off.

Control UI lives inside the Recovery workspace, not as a second app: `src/app/app/page.tsx` and `src/app/workspace/recovery/control/*`.

Migrations of record: `infra/postgres/migrations/0002` through `0077`. The story in the filenames is the company's actual history: living ledger, billing entitlements, autopilot, Recovery receipts, decision cycles, Commitment Control (`0057`), invites and authority hardening, attention outbox, Zoho observations, provider-bill admission.

Tests exist for the control loop and for Postgres. CONTINUE-HERE on 2026-09-09 recorded a local disposable Postgres run of 319/319 and a full unit run of 1,402/1,403, plus a failed strict Lighthouse sample on `/pay`. Those are local claims in the handoff, not re-run for this review. **NOT VERIFIED** as a current green tree.

## Commercial evidence on hand

From `docs/execution/scoreboard.md`, last business-validation update 2026-09-02 and distribution update 2026-09-04:

- Composite floor is business validation and distribution, both **1.5**.
- Substantive conversations **0**. Identical ₹14,999 offers **0**. Upfront paid pilots **0**.
- Three sourcing cells were marked evidence-ready at 5/5/5. Contacted: 3 of 15. Replies that count as conversations: 0.
- Phase B is described as code-complete and customer-data blocked.

CONTINUE-HERE through 2026-09-09 adds audience activity (a verified partnership email, Reddit comments, an X video with a few dozen impressions, a GitHub curator issue). The handoff itself says none of that is a qualified conversation, an offer, or a payment. This review did not recount those private files and does not treat them as demand.

**INFERENCE.** The company has a working software skeleton and no evidence that anyone has paid for the job. Low usage does not prove the problem is fake. It does prove that distribution and willingness to pay are unmeasured, and that more interface work has not created a customer.

## Preserve, repurpose, stop saying, freeze

| Asset | Action |
| --- | --- |
| Control policy, proposal, human decision, frozen cap, reconciliation, labeled outcome | Preserve. This is the candidate pilot if the gate passes |
| Recovery evidence store, receipt parser, cite-or-shut-up rules, workspace isolation, encryption, deletion | Preserve as the evidence shelf under Control. Do not market Recovery as a separate subscription product |
| Synthetic `/demo` and the landing desk | Preserve for interviews. Every figure on it is a placeholder. Do not let prospects confuse it with their books |
| Zoho bill snapshot and disposition | Freeze until a buyer who already lives in Zoho Books asks for it, and until assessment and enrollment gates pass |
| Receipt inbox | Freeze as an optional later evidence pipe. Not required to test the job |
| Autopilot execution, standing mandates, Gmail OAuth, bank / Setu / card connectors, public checkout, guest financial paste | Freeze. Do not revive in positioning or in a pilot |
| `src/lib/twin/` runway and what-if | Freeze. It is a second product inside the repo |
| Live `/start` paste | Remove from positioning as soon as a copy change is separately authorized. Until production locks intake, do not send anyone there with a real bill |
| Untracked `research/` Instruction Ledger pack | Leave parked. It is not a build authorization |

## Broken or inaccessible, short list

1. **BROKEN trust boundary on production `/api/audit` and `/start`.** Source and site disagree.
2. **MISSING payment path.** The only public price cannot be paid on the site that advertises it.
3. **NOT VERIFIED production schema, backup head, and cron success** since the 2026-09-09 handoff.
4. **NOT VERIFIED** whether Google sign-in completes for a new user. `/login` returns 200. A login was not performed.
5. **NOT VERIFIED** any telemetry funnel. `npm run funnel` can read a private env. It was not run, because this review must not pull customer records into a planning doc.

## Addendum — 2026-10-24, execution sprint

Local tests `tests/audit-route.test.ts` and `tests/financial-intake.test.ts` passed 27/27 on Node v22.23.2. Source rejects uncleared guest receipt text. Production was **not** requested again. The HTTP 200 observation earlier in this file remains the last live data point and is still a blocker. See `docs/discovery/2026-10-24_sprint/10_PRODUCTION_SAFETY_BLOCKER.md`.
