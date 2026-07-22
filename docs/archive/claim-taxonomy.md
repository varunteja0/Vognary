# Product claim taxonomy

Last verified: 2026-07-11

Vognary claims only the weakest state proven by current evidence. A catalog entry, configured environment variable, successful build, or one sandbox response is not a production-live connector.

## Required states

| State | Meaning | Minimum evidence |
| --- | --- | --- |
| `hypothesis` | A customer or market assumption that still needs validation. | Named owner, target user, test method, and decision date. |
| `planned` | A modeled product or provider target with no working user path. | Contract/interface sketch and known access boundary. |
| `implemented` | Code exists for a user or evidence path. | Reviewed code and focused automated tests. |
| `configured` | Required runtime configuration is present. | Readiness check without returning secret values. |
| `sandbox-proven` | An authorized non-production account completed the expected flow. | Timestamped run, fixture/response contract, and failure-path test. |
| `beta-live` | Approved beta users can complete the flow with real data. | Authenticated end-to-end run, durable write, resync, disconnect, source-health state, and support owner. |
| `production-live` | The flow is approved for general production use. | Provider/legal approval where required, production credentials, observability, SLO, deletion/revocation, and at least one successful production consent. |
| `partner-blocked` | Product code alone cannot make the source available. | Named provider/regulated dependency and an honest fallback. |
| `evidence-only` | A manual, receipt, or file path can create evidence but does not synchronize automatically. | Working capture/import path and visible freshness limitation. |

## Language rules

- `Live` is reserved for `beta-live` or `production-live`, and the UI must say which one.
- `Automatic` requires a background resync path; a user clicking **Run now** or **Import evidence** is not automatic.
- `Real-time` requires a provider push/webhook SLA. Polling is described with its actual freshness interval.
- `Verified` requires source-scoped proof. An unrelated newer source cannot prove that a charge stopped.
- `Checksum intact` means report content matches its included SHA-256 value; it never proves authorship because anyone can recompute and replace both. `Vognary-issued` requires a valid Ed25519 signature from a key in the published Vognary registry, and still does not certify the accuracy of the underlying financial claims.
- `Every`, `complete`, and `universal` require measured coverage evidence for the stated population and period.
- `Bank-grade`, `secure`, and compliance claims name the concrete control or independent assurance rather than using an undefined superlative.
- Registry counts are never presented as working connector counts.

## Release rule

Every public product claim must link to one of: a test, an observed production metric, a provider approval, a security assurance, or an explicitly labeled hypothesis. A lower state automatically overrides marketing copy, screenshots, documentation, and sales material.
