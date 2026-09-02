# Three-cell market-test outreach

> Live contract: [`docs/execution/phase-a-market-contact.md`](../execution/phase-a-market-contact.md)
>
> These are founder-operated scripts. **Only the founder sends**, records a
> reply, runs a conversation, makes an offer, invoices, or marks payment. Vognary
> does not send outreach automatically. A draft, opened profile, delivered mail,
> or pending invitation is not a reply or conversation.

## Before sending

1. Assign exactly one test cell in the private CRM.
2. Run `npm run market:cohort-gate`. A red gate means sourcing is incomplete;
	it does not authorize filling evidence fields by inference.
3. Verify the named role and public source on the day of contact.
4. Respect channel limits and stop after any restriction or opt-out. Do not work
	around LinkedIn protections.
5. Do not ask for a merchant, amount, receipt, contract, credential, proposal,
	or other real financial data before the assessment/retest and legal/security
	gates clear.

## Connection notes

Recheck the live channel limit before sending.

### `DIRECT_FINANCE`

```text
Hi {Name} - I am studying how AI-native teams preserve the evidence, policy and human cap behind AI/SaaS/cloud commitments. Could I ask about the last real decision? - {Founder}
```

### `FRACTIONAL_FINANCE`

```text
Hi {Name} - I am studying how fractional finance teams preserve approval evidence and outcomes across startup clients. Could I ask about one recent AI/SaaS/cloud commitment? - {Founder}
```

### `FINOPS_AI_OPERATIONS`

```text
Hi {Name} - I am studying how FinOps teams connect early decisions to later AI/SaaS/cloud cost outcomes. Could I ask about one recent commitment? - {Founder}
```

## After acceptance or direct reply

```text
Thank you. I am running a 20-minute behavioral conversation, not a product pitch.

I want to understand the last real AI, SaaS, or cloud commitment you governed: when the company became committed, what evidence and policy existed, who could cap it, and what the later bill showed.

Before our security gate closes, please keep merchants, amounts, receipts, contracts, credentials, and other financial details out of messages. A date and the shape of the decision are enough.

Would {two specific times} work?
```

Record `replied_at` only for a substantive reply. Record `conversation_at` only
after the conversation happens.

## Common behavioral opening

Do not show Vognary during the first 12-15 minutes.

```text
Walk me through the last real AI, SaaS, or cloud commitment you governed.

When did the company become committed: before an invoice, when somebody said yes, when a card or API was used, or only when the bill arrived?

Who could have capped or declined it, and what evidence and policy did that person have?

Where did the decision live?

Could you reconstruct the original evidence, person, cap, and what the later bill showed?

What happens today if somebody or an automated system ignores the agreed cap?
```

Classify behavior, not enthusiasm:

- `PRE_SPEND`: they commit to bring a future decision before obligation.
- `RECOVERY`: they commit to bring a past or current bill that escaped, changed,
  or cannot be explained.
- `DECISION_TO_OUTCOME`: they commit to bring an authorization and later evidence
  so the two can be reconciled.
- `NONE`: no qualifying event or consequence exists.
- `UNMEASURED`: the conversation did not resolve it.

## Descriptor and enforcement test

Only after behavioral discovery:

```text
I am testing Vognary as an Authorization Ledger for AI, SaaS, and cloud commitments. It preserves the cited evidence, policy, person, decision, and frozen cap, then reconciles what happened.

It records and proves. It does not pay, purchase, or block a card or API.

Without enforcement, is that useful enough to change how you handle the next event, or would you only adopt something that can stop the transaction?
```

Record `ADVISORY_ACCEPTED`, `NEEDS_ENFORCEMENT`, or `UNMEASURED`. Do not defend
the boundary or promise a connector, card, wallet, payment rail, or autonomous
action.

## Qualifying-event ask

```text
Which one real upcoming or recent event would you bring next?

Before clearance, name only the event class and timing, not the company, merchant, amount, receipt, contract, or credential. If the gates clear, would you book a working session for that event within 30 days?
```

Set `next_event_committed_at` only after an explicit commitment and agreed next
step. Interest is not commitment.

## Synthetic demonstration

```text
I can show a synthetic demonstration now using invented companies and amounts. It demonstrates the workflow only; it does not prove savings, customer use, or production readiness.
```

The demonstration must preserve the five-step contract: cited exposure,
proposed assumption, deterministic policy context, named human decision with a
frozen cap, and later evidence reconciled without rewriting the decision.

## Identical pilot offer

Make this offer to credible buyers until ten offers are recorded. Do not add a
discount, trial, pricing menu, response SLA, or custom feature promise.

```text
The pilot is a one-time ₹14,999 payment for one month.

It includes one policy setup, up to ten proposals, up to four weekly 30-minute reconciliation reviews, and up to two additional founder-support hours. There is no automatic renewal. A second month requires a separate purchase.

Vognary records decisions and evidence. It never auto-approves, purchases, provisions, cancels, or moves money.

Payment reserves the pilot. Real customer data and activation remain blocked until the independent assessment/retest and legal/security gates clear. If Vognary cannot activate within ten business days after payment, you may request a full refund.

Would you like the specific one-time invoice?
```

Record `offer_at`, `invoice_commitment_at`, `invoice_sent_at`, and
`payment_received_at` separately. Only independently verified cleared funds
count as payment.

## One follow-up

```text
Closing the loop on the specific pilot offer. Is the next step the one-time invoice, a later date, or no?

Any answer is useful. I will not keep following up after this message without a reply.
```

Record a clear no and its loss reason. Never convert silence into intent,
urgency, or offer acceptance.

## After a working session

```text
The record now shows the cited evidence, policy version, named decision and frozen cap. Later evidence has not been linked yet, so the outcome remains unmeasured.

Please submit the second qualifying proposal without my help. When later evidence exists, we will link it and record T5 only if reconciliation completes without changing the original cap.
```

T3 requires a recorded decision, T4 requires repeat behavior without founder
rescue, and T5 requires a real reconciliation after customer-data clearance.
