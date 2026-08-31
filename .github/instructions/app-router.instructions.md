---
applyTo: 'src/app/**/*.ts,src/app/**/*.tsx'
---

> **Operating motto: Take smart risks. Do not play safe.** Bound the downside.

# App Router rules

`next@16.3.0`, `react@19.2.4`. **This is not the Next.js in your training data.**

- Read the relevant guide in `node_modules/next/dist/docs/` **before** writing App
  Router code. If that directory is empty you are in a fresh worktree — run
  `nvm use 22.23.2 && npm ci` first, or you will write Next 15 from memory.
- Use the canonical `src/app/workspace/*` implementation. Never recreate the
  retired monolith.
- Server Components by default. Add `'use client'` only where interactivity
  requires it, and push the boundary as low in the tree as possible.
- Design tokens are enforced by `npm run tokens:check`. No raw hex, no ad-hoc
  spacing. **No design-system rewrite.**
- No invented amounts, merchants, customer counts, or connector states in any user
  visible string — including placeholders and empty states. Placeholder copy ships.
- Hard stops: no Standard Checkout modal, no `RAZORPAY_KEY_SECRET` on the client,
  no reopening `/api/checkout`, no fake paid-customer claims.
