# Phase B — Loop product shipping (agent architecture guide)

> **Parent law:** [`docs/THE-LAW.md`](../THE-LAW.md)  
> **Companion product phases:** CONTINUE-HERE Phases 1–4 (engineering slice of this phase)  
> **UI/AI WPs:** `docs/execution-plan-ui-ai-quality.md`  
> **AI/Twin implementation law:** `docs/master-build-plan.md` Parts 3–5  

**Goal:** Make the core loop inevitable in the product so market audits (Phase A) feel magical, not manual.

```
evidence in → recurring audit → assistant brief → decide → log outcome with proof
```

---

## 0. Target experience (definition of “undeniable”)

| Step | User sees | Max time | Primary files / routes |
| --- | --- | --- | --- |
| 1. Enter | Clear CTA; no fake results | 10s | `src/app/page.tsx`, guest path |
| 2. Evidence | Paste / upload / Gmail | 60–90s | ingest, guest-audit, Gmail OAuth |
| 3. Insight | Monthly burn + next debit + 1 action | **<3 min total** | engines + brief |
| 4. Brief home | Signed-in default = what needs attention | instant | `assistant-brief*`, `/app` |
| 5. Decide | keep / watch / cancel / investigate | 30s | decisions API + UI |
| 6. India win | UPI mandate kill-list from statement alone | same session | `mandate-killlist*` |
| 7. Proof | Export / verify path honest | 30s | audit-pack, `/verify` |

**Release claim:** only after e2e covers the loop and Phase A shows humans complete it.

---

## 1. Architecture map (agents plan from this — do not redesign)

```
┌─────────────────────────────────────────────────────────────────┐
│  UI                                                             │
│  page.tsx (landing) → /app guest | signed-in workspace shell    │
│  workspace/assistant-brief-panel.tsx  ← DEFAULT HOME            │
│  workspace/mandate-killlist-panel.tsx                           │
│  vognary-mvp-client.tsx (LEGACY MONOLITH — extract, don’t grow) │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│  API                                                            │
│  POST /api/audit  POST /api/ingest                              │
│  GET  /api/workspaces/current/brief                             │
│  POST /api/workspaces/current/ask                               │
│  GET  /api/workspaces/current/mandate-killlist (or equiv)       │
│  connectors / Gmail OAuth / decisions / outcomes                │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│  Deterministic fact engines (SOLE SOURCE OF MONEY TRUTH)        │
│  receipt-parser → recurring-audit → renewal-timeline            │
│  suggested-cuts · mandate-killlist · assistant-brief            │
│  proof-graph · proof-questions · verified-savings               │
│  twin/{project,runway,whatif}                                   │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│  AI (optional, fail-closed)  src/lib/server/ai/*                │
│  extract (schema) · reconcile · narrate · citations             │
│  validateCited MUST pass or output discarded                    │
│  inert without ANTHROPIC_API_KEY                                │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│  Persistence                                                    │
│  living-ledger-store · proof-graph-store · workspace snapshots  │
│  decision / outcome stores · connector token vault              │
└─────────────────────────────────────────────────────────────────┘
```

### Design rules when adding code

1. **Facts never originate in the LLM.**  
2. **New UI** prefers `src/app/workspace/*` panels, not more monolith lines.  
3. **Honesty states** from `getConnectorHonesty` / connector registry — no “connected” without proof.  
4. **INR default**; multi-currency explicit.  
5. **Tests first** for engine changes.  

---

## 2. Work packages for agents (ordered)

Execute in order. Each WP = one branch from `main`, one PR.

### WP-B0 — Baseline integrity (do first if dirty)

- [ ] `npm run lint && npm run typecheck && npm run claims:check && npm run tokens:check && npm test`  
- [ ] Confirm token gate + brand checks exist  
- [ ] Note any failing e2e; fix only loop blockers  

**Done when:** green local gate chain.

### WP-B1 — Landing honesty (CONTINUE Phase 1)

**Problem:** Sample ledger numbers can read as real user results.

**Do:**

- Label sample audit as **illustrative / sample** in UI copy  
- Ensure no unlabeled “results” that look measured  
- Guest connect card uses honesty helpers, not “linked” language  

**Files (likely):** `src/app/page.tsx`, guest connect components, claims corpus if copy moves to checked docs  

**Tests:** claims:check; optional Playwright landing assertion  

**Done when:** founder cannot mistake sample for live personal totals.

### WP-B2 — Time-to-first-insight path

**Do:**

- Guest paste → visible burn + next debit + one action without login  
- Remove dead ends / extra chapter noise on first run  
- One primary onboarding path (not three competing CTAs)  

**Files:** `guest-audit-client.tsx`, `instant-audit*`, `first-action.ts`, workspace entry  

**Tests:** `tests/e2e/first-value-path.spec.ts`, `landing-instant-audit.spec.ts`  

**Done when:** cold user <3 min to a proven number on mobile + desktop.

### WP-B3 — Gmail success moment

**Do:**

- OAuth callback lands `/app?connected=gmail` (or equivalent)  
- Surface “here’s what we found” from first sync / import  
- Honest empty state if zero receipts  

**Files:** Gmail callback routes under `src/app/api/integrations/gmail/*`, workspace hydration  

**Tests:** source-route / e2e with mocked OAuth where possible; manual proof with test user when credentials exist  

**Done when:** connected user never lands on a blank dense dashboard without explanation.

### WP-B4 — Assistant brief as default signed-in home

**Do:**

- Default `/app` view = assistant brief (renewals, anomalies, kill candidates)  
- API: `GET /api/workspaces/current/brief` backed by `assistant-brief.ts` + store  
- Ledger / advanced chapters are drill-downs  

**Files:**  
- `src/lib/assistant-brief.ts`  
- `src/lib/server/assistant-brief-store.ts`  
- `src/app/workspace/assistant-brief-panel.tsx`  
- shell / `vognary-mvp-client.tsx` only as thin integration  

**Tests:** `tests/assistant-brief.test.ts` + e2e signed-in first value  

**Done when:** signed-in users can act without scrolling a wall of panels.

### WP-B5 — UPI mandate kill-list (India-first win)

**Do:**

- Statement/paste path surfaces UPI/AUTOPAY/MANDATE/EMI/SIP/NACH items  
- Per-PSP cancellation guidance (honest, manual where no API)  
- Works **today** without AA partner  

**Files:**  
- `src/lib/mandate-killlist.ts`  
- `src/lib/server/mandate-killlist-store.ts`  
- `src/app/workspace/mandate-killlist-panel.tsx`  
- API route if not complete  

**Tests:** `tests/mandate-killlist.test.ts` + statement fixture  

**Done when:** one real Indian statement produces a usable kill-list without partner rails.

### WP-B6 — AI live path (blocked on founder key)

**Do only after** `ANTHROPIC_API_KEY` + `AI_MONTHLY_BUDGET_INR` in env contract:

- Ingest AI fallback for parser rejects → reconcile totals → confidence-capped  
- `/ask` compiles to bounded queries; narrate with `validateCited`  
- Degrade cleanly when key/budget missing  

**Files:** `src/lib/server/ai/*` — follow master-build-plan Part 3  

**Tests:** `tests/ai-guardrail.test.ts`, `ai-live-layer.test.ts`  

**Done when:** no code path can render uncited money claims.

### WP-B7 — Monolith extraction (quiet window)

**Do:**

- Move shells into `src/app/workspace/*`  
- Target: route shell <300 lines; panels isolated  
- Remove `WP4_DEFERRED` only when tokenized  

**Forbidden during this WP:** redesign visual system; new product features  

**Done when:** new features do not require editing the 5k-line file.

### WP-B8 — Full-loop e2e + no-demo release checklist

**Do:**

- Playwright: guest insight → sign-in → brief → decision → export  
- Extend `check-release-gate.mjs` no-demo checks  
- Corpus progress visible even if below 100  

**Done when:** Phase B exit gate green and founder can demo without lying.

---

## 3. File ownership map (avoid collisions)

| Area | Prefer editing | Avoid |
| --- | --- | --- |
| Brief logic | `assistant-brief.ts`, store, panel | reinventing ranking in UI |
| Mandate | `mandate-killlist.ts`, panel | hardcoding PSP copy in 10 places |
| Recurrence truth | `recurring-audit.ts` | AI inventing cadence |
| Timeline | `renewal-timeline.ts` | Date.now hacks in components |
| AI | `server/ai/*` only | client-side LLM keys |
| Connectors | `connectors.ts`, adapters | claiming live without honesty state |
| Money format | `lib/format.ts` | ad-hoc `₹` strings |

---

## 4. Parallelism rules for multi-agent / Fable

| Safe parallel | Must serialize |
| --- | --- |
| WP-B1 landing honesty ∥ WP-B5 kill-list engine tests | Monolith extractions touching same lines |
| Docs-only CRM work (Phase A) ∥ WP-B2 | Gmail OAuth + session binding changes |
| AI unit tests with mocks ∥ brief UI | Live AI + ingest materialization |

**Always:** separate git worktrees; PR against `main`; rebase/fresh branch each WP.

---

## 5. Verification commands (Phase B)

```bash
# unit + honesty
npm run lint
npm run typecheck
npm run claims:check
npm run tokens:check
npm test

# build + perf
npm run build
npm run perf:budget

# browser (loop)
npm run test:e2e

# when DB available
DATABASE_URL='…' POSTGRES_SSL=false npm run test:postgres

# production claims only against real deploy
npm run production:check -- https://www.vognary.com
```

---

## 6. Out of scope until Phase B exit + Phase A GO

- Merchant intelligence network  
- New SaaS connectors beyond fixing Gmail path  
- Platform API consumers  
- Design-system rewrite  
- Concierge verified-savings marketing  
- AA production code (onboarding paperwork OK)  

---

## 7. Agent implementation prompt (copy into new sessions)

```text
You are implementing Vognary Phase B under docs/THE-LAW.md.
Read: docs/THE-LAW.md → docs/CONTINUE-HERE.md → docs/execution/phase-b-loop-shipping.md.
Raise the product loop only. No new plans. No uncited AI. India-first INR defaults.
Worktree from main. Failing test first for engines. PR against main.
Start at the lowest incomplete WP-B0…B8. State scoreboard row + files before coding.
```

---

## 8. Exit criteria (Phase B complete)

- [ ] Sample/landing cannot be mistaken for live results  
- [ ] Guest <3 min to insight (measured in e2e + 3 real humans)  
- [ ] Signed-in default = assistant brief  
- [ ] Gmail path has success moment when credentials exist (honest otherwise)  
- [ ] UPI kill-list works from statement  
- [ ] AI either off-with-grace or live-with-citations (never half-lying)  
- [ ] Full-loop e2e green  
- [ ] CONTINUE-HERE phases 1–3 marked with evidence links  

Then: prioritize Phase C production activation (founder-ops) + continue Phase A volume.
