# Integration Checklist

## Gmail Read-Only

- Create Google Cloud project.
- Configure OAuth consent screen.
- Add `https://www.googleapis.com/auth/gmail.readonly` only.
- Add redirect URI: `/api/integrations/gmail/callback`.
- Fill `.env` values.
- Run `/api/integrations/gmail/start`.
- Verify callback returns receipt candidates.
- Submit OAuth app verification before public launch.

## PDF Statements

- Collect 5 anonymized statement exports from first beta users.
- Record bank/card issuer, PDF layout, and extraction accuracy.
- Add issuer-specific parsing heuristics only after seeing real layouts.
- Keep CSV as recommended highest-confidence path.

## Persistent Storage

- Provision PostgreSQL.
- Apply `infra/postgres/schema.sql`.
- Provision object storage.
- Add envelope encryption for uploaded files.
- Add account deletion and file deletion.
- Add audit logging for every read and write.

## Account Aggregator

- Decide whether Vognary becomes FIU directly or works through a TSP/regulated partner.
- Confirm allowed purpose and consent artifact requirements.
- Confirm whether recurring commitments can be inferred from available account data.
- Run legal review before any production user flow.

## UPI/Card Mandates

- Identify whether mandate data is available through bank/card issuer, payment aggregator, or user-uploaded exports.
- Start with user-visible mandate instructions and manual confirmation.
- Do not promise one-click cancellation until provider APIs exist.

## Cloud/SaaS Connectors

- Prioritize OpenAI, Anthropic, GitHub, Vercel, Render, AWS, Cloudflare, domain registrars.
- Use read-only billing/usage scopes where available.
- Store tokens only after encrypted persistence is implemented.