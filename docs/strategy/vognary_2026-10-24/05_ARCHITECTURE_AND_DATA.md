# Architecture and data

No new service is proposed. The validated use case fits the application that already exists.

## What is running

**FACT.** Vognary is one Next.js 16 App Router app. PostgreSQL is the system of record. Sessions are signed cookies. A token vault encrypts connector secrets when a vault key is configured. Live `/security` on 2026-10-24 said the vault and signed cookies are configured, and that backup storage is configured without a valid restore-record hash.

Control state is already modeled. The objects to reuse, from `src/lib/commitment-control/contracts.ts` and migration `0057` onward:

| Object | Role | Rule that must not be weakened |
| --- | --- | --- |
| Policy version | Category posture and currency ceilings | New version on change. Decisions keep the version they used |
| Proposal | Merchant, purpose, category, amount, currency, cadence, first charge date, intended outcome | Amount is an assumption until evidence is linked |
| Evaluation | Policy result and cited exposure | Always requires a human. Missing evidence is a reason, not a zero |
| Decision | Approve, approve with cap, or decline; person; time; expiry; reason | Immutable. Cap does not move when a bill arrives |
| Reconciliation | Evidence id, observed amount, verdict | One comparison. Do not overwrite history with a "corrected" bill; add another reconciliation or an exception review |
| Outcome observation | User-entered value | Never presented as Recovery evidence |
| Exception review | No further action, new proposal required, or corrected outside Vognary | The only legal way to close an overrun without pretending the cap changed |
| Recovery evidence | Pasted, uploaded, or forwarded receipt text, encrypted | Cite-or-shut-up. Workspace-scoped queries |
| Provider bill | Optional Zoho or other admitted snapshot | A bill total is not a cash payment. Comparison basis stays explicit (`GROSS_BILLED_TOTAL_PER_CHARGE` versus `PROVIDER_BILL_TOTAL`) |

Enrollment (`src/lib/commitment-control/enrollment.ts`) already refuses production financial intake unless the workspace is on the paid allowlist and an independent assessment evidence object clears. Keep that. The live site is not yet enforcing the anonymous audit lock that source code intends. That is an operations defect, not a reason to add a second gate system.

## What not to reuse as architecture

- Autopilot execution, veto tokens, and standing mandates. They are a different product and default off for a reason.
- `src/lib/connectors/*` provider adapters and the Setu account-aggregator start route. Retired at the public connector API. Leave the files. Do not build the pilot on them.
- `src/lib/finops-control/capability.ts`. A signed grant that could authorise a provider call is premature. The pilot does not execute provider actions.
- `src/lib/twin/` runway and what-if. A forecasting product.
- In-memory or guest session storage as a customer record. The pilot starts only inside an enrolled workspace.
- A new microservice, queue, or event bus. Attention outbox tables `0065`–`0068` already exist if email is ever turned on. Do not add infrastructure to send mail the deployment has not proved it can send.

## MVP shape, only after the conversation gate

```text
Browser (control desk)
    → session, workspace role
    → /api/workspaces/current/control/* 
    → commitment-control store (Postgres, tenant-scoped)
    → optional evidence row (encrypted raw text + normalized facts)
    → reconciliation verdict (deterministic)
```

No worker is required for the first month. The founder and the customer can reconcile on a call. The hourly Zoho cron in `vercel.json` stays a candidate for a later buyer who already uses Zoho Books. It is not part of the first pilot unless that buyer is the one who passed the gate and names Zoho as the place the bill already lives.

### APIs already present

- `PUT /api/workspaces/current/control/policy`
- `POST /api/workspaces/current/control/proposals`
- `POST .../proposals/:id/decision`
- `POST .../proposals/:id/reconciliations`
- `POST .../proposals/:id/outcome`
- `POST .../proposals/:id/exception-reviews`
- `GET /api/workspaces/current/control/brief`
- Evidence: `POST /api/workspaces/current/evidence`

Internal routes under `/api/internal/*` stay secret-gated. Public `/api/readiness` already returns 401 without the internal secret.

### Failure behaviour

| Failure | Required behaviour | Already the design? |
| --- | --- | --- |
| Policy missing | Proposal can be stored only if the product's current validation allows it; evaluation must say the category or currency rule is missing. A missing rule is not an approval | Yes, reason codes in `policy.ts` |
| Evidence unreadable | Say so. Do not invent merchant, amount, or date | Yes, on the Recovery parser. Re-check copy before a pilot |
| Currency differs | Verdict `CURRENCY_MISMATCH`. No silent FX | Yes |
| Authorisation date passed | `AUTHORIZATION_EXPIRED` | Yes, later migrations |
| Same person double-submits | Idempotency on the control write path. Do not create two caps | Claimed in the September handoff as repaired. Re-test before any pilot. Not re-tested in this review |
| Provider or Zoho down | The manual bill still reconciles. Zoho failure must not block the decision | Zoho is evidence-only. Keep it that way |
| Model timeout | Signed-in control does not call a model. Guest ingest might, if a key is set | Do not enable guest ingest for the pilot |
| Attempt to auto-decide | No code path in `evaluateProposalPolicy` returns an approval | Keep the type as `humanDecisionRequired: true` |

## Security and privacy for a pilot that handles real bills

The pilot is financial data. The existing rule stands: payment does not open data access. An independent assessment and retest with no open critical or high finding, and no open medium that touches data, comes first. This review did not commission that assessment and must not mark it done.

Minimum bar before any real bill is typed in:

1. Production anonymous `POST /api/audit`, `/api/ingest`, and `/api/receipt-image/propose` match source and reject uncleared financial input.
2. `/start` stops inviting a real upload, or the upload cannot leave the browser. A copy change is a later, separate change. Until then, do not send customers there.
3. Production schema head is known and matches the migrations the pilot uses. The September backup gap (`0056` observed versus `0077` required) is unresolved until someone with database access checks it.
4. A restore of an encrypted backup has a recorded hash, which `/security` currently says is missing.
5. Workspace queries stay scoped to the session workspace. Application-level isolation is what the product has. Do not advertise a certified tenant audit.
6. Raw receipt text stays encrypted. Retention of raw text after 30 days runs only when the retention job is actually attested. Until then, tell the customer the schedule is not proven.
7. Export and delete on `/profile` work on a production-like workspace with synthetic data before they are promised on a real one.
8. Logs and error reporters do not store receipt bodies. Confirm this before the pilot. Not confirmed in this review.
9. Support email must refuse card numbers, OTPs, and bank passwords. `/pay` already says this.
10. Access is least privilege: one customer workspace, owner role for the buyer, no shared founder login used as the customer's identity. If the founder assists, they are an invited admin and that fact is visible.

Data minimisation for the first month: merchant, purpose, amount, currency, dates, category, the bill excerpt needed to cite the amount, and the decision. Do not collect PAN, full bank accounts, or employee lists. GSTIN only if it is already printed on a bill the customer chose to submit, and do not build a GST product out of it.

Deletion: the customer can request account deletion through the existing privacy flow. Say clearly, as `/security` already does, that backups and the email provider do not disappear in the same minute.

## Integration sequence

Justified only by the buyer, in this order:

| Order | Integration | Why it would earn its place | Why it is not first |
| --- | --- | --- | --- |
| 0 | None. Paste or upload a bill the customer already downloaded | Proves the decision job without a vendor relationship | Manual. Acceptable for a one-month pilot. Not a moat |
| 1 | Zoho Books bill read, already sketched | Many Indian product companies already keep supplier bills there. The code and migrations exist | Needs OAuth, an allowlist, assessment, and a buyer who names Zoho unprompted |
| 2 | Private receipt alias for invoices the customer forwards | Removes repeat paste for the second month | Forwarding is easy to misconfigure, and retention is not attested |
| 3 | A single provider cost export (CSV the customer downloads from OpenAI, Anthropic, or AWS) | Closes "the invoice is not the usage" | A CSV is still manual. Do not build OAuth until customers ask twice |
| Not in the first year without a new decision | Card feeds, bank feeds, Gmail, gateways, write access to any provider | Those are different companies | They also create the enforcement buyers may actually want. If interviews say enforcement is the job, stop and reconsider the company. Do not half-build a card |

## Auditability

Every decision already stores who acted and when. The pilot's acceptance test is: a second person can open the brief and answer, without asking the founder of Vognary, who approved what, on which policy version, with which cap and expiry, and what the later bill did. If the UI cannot answer that in one screen, fix the screen before selling the month. Do not add an audit-log product beside it.

## Proportion

Postgres, the existing app, and founder-assisted operation are enough for ten proposals. Kubernetes, a model, a queue, and a second region are not required to learn whether anyone pays.
