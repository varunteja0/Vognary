# Vognary Read-Only Platform API

The first stable API surface is intentionally read-only. It lets an approved
workspace feed its canonical recurring ledger and source-health state into an
internal finance workflow without exposing provider credentials or raw source
bodies.

## Token lifecycle

- Workspace admins create tokens through `POST /api/platform/tokens`.
- The plaintext begins with `vgy_live_` and is returned exactly once.
- PostgreSQL stores only a SHA-256 token hash and a short display prefix.
- Tokens require one or both explicit scopes: `ledger:read`, `sources:read`.
- Expiry is 1–365 days (90 by default). Revocation is immediate.
- Create and revoke actions are written to the workspace audit log.

Example:

```bash
curl -H "Authorization: Bearer $VOGNARY_TOKEN" \
  https://www.vognary.com/api/v1/ledger
```

Every API response is private/no-store and carries `X-Request-Id`. Token and
network rate limits are independent. The machine-readable contract is
[`docs/api/openapi.yaml`](./api/openapi.yaml).

`GET /api/v1/ledger` returns at most 100 commitments and 100 decisions by
default (maximum 200 of each). When `page.hasMore` is true, pass the opaque
`page.nextCursor` back as `?cursor=...`; do not parse or construct cursors.

## Current boundary

There is no write endpoint for decisions, cancellations, connector creation,
bank data, or mandate changes. Those operations require the signed-in product,
explicit user review, and (for regulated rails) an approved partner contract.
