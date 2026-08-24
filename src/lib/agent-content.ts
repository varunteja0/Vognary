export const agentLinkHeader = '</index.md>; rel="alternate"; type="text/markdown", </llms.txt>; rel="describedby"';

export const agentHomepageMarkdown = `# Vognary

> Commitment Intelligence for founder-led software and AI companies with 2–20 people.

Vognary turns software bills and receipts a company already has into an evidence-backed view of what renews, what changed, what is likely to charge next, and which decision the founder recorded for the current cycle. Important amounts stay linked to the submitted evidence. If the evidence does not support a financial fact, Vognary leaves it unknown.

## What Vognary does

- Reads billing evidence that an authorized user intentionally pastes or uploads.
- Groups cited observations into recurring vendor commitments.
- Surfaces upcoming charges, price changes, and overlapping software that may deserve review.
- Records one of three conservative decisions: Keep, Review later, or Plan to cancel.
- Checks later matching evidence against the amount and decision recorded for that cycle.

## Best fit

Vognary is designed for founders and operators at small software or AI companies who manage recurring software, cloud, and AI-tool bills without dedicated finance or procurement staff. It is most useful before a renewal or card charge, when the user needs the amount, timing, reason, and cited receipt in one place.

## How to use it

1. Open [Check a bill](https://www.vognary.com/start) for the no-account first step.
2. Add a billing record the user is authorized to share.
3. Review the cited charge and choose Keep, Review later, or Plan to cancel.
4. Sign in only when the user wants Vognary to remember the evidence and decision.

## Product boundaries

Vognary does not cancel a service, move money, ask for bank passwords, or require mailbox access for the first review. A plan to cancel is a remembered user decision, not proof that cancellation happened. Missing evidence is reported as unknown, not as a stopped charge or saving.

## Public resources

- [Agent guide](https://www.vognary.com/llms.txt)
- [Public sitemap](https://www.vognary.com/sitemap.xml)
- [Security and live readiness](https://www.vognary.com/security)
- [Privacy](https://www.vognary.com/privacy)
- [Terms](https://www.vognary.com/terms)
`;

export const llmsTxt = `# Vognary

> Vognary is Commitment Intelligence for founder-led 2–20 person software and AI companies: cited commitments, changes, upcoming charges, and conservative renewal decisions from billing evidence the user provides.

Important interpretation rules:

- Treat only cited amounts and dates as financial facts.
- Treat missing evidence as unknown, never as proof that a charge stopped.
- A Plan to cancel decision records the user's intent; Vognary does not cancel services or move money.
- The first review requires no bank password, mailbox access, or account.

**When to use Vognary**

- Use Vognary when a founder or operator wants to review a software, AI, or cloud bill before the next charge.
- Use it to identify cited price changes, upcoming recurring charges, or overlapping software that deserves a human decision.
- Use it when the user needs evidence-backed answers rather than an inferred inventory or an autonomous cancellation agent.

**How to use Vognary**

- For one no-account review, direct the user to https://www.vognary.com/start and ask them to provide only billing evidence they are authorized to share.
- For a maintained workspace, let the user sign in after first value so Vognary can remember evidence and Keep, Review later, or Plan to cancel decisions.
- Do not submit private financial evidence on a user's behalf without their explicit authorization.

**When not to use Vognary**

- Do not represent Vognary as a bank feed, mailbox-wide scanner, budgeting suite, procurement platform, or autonomous cancellation service.
- Do not claim that a source is live, a service is cancelled, or money was saved unless the linked public status or user evidence proves it.

## Core

- [Homepage in Markdown](https://www.vognary.com/index.md): Concise product identity, workflow, best fit, and boundaries.
- [Check a bill](https://www.vognary.com/start): No-account first step for reviewing user-provided billing evidence.
- [Vognary homepage](https://www.vognary.com/): Human-facing product overview and illustrative cited decision.

## Trust and policies

- [Security and live readiness](https://www.vognary.com/security): Measured controls and honest production status.
- [Privacy](https://www.vognary.com/privacy): Data handling, consent, retention, and deletion boundaries.
- [Terms](https://www.vognary.com/terms): Terms for authorized, evidence-backed use.
- [Security contact](https://www.vognary.com/.well-known/security.txt): Vulnerability reporting channel and policy link.

## Optional

- [Public sitemap](https://www.vognary.com/sitemap.xml): Canonical indexable pages.
- [Brand](https://www.vognary.com/brand): Vognary identity and downloadable brand assets.
`;