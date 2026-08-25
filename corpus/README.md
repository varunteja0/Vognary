# Statement corpus

> **Operating motto: Take smart risks. Do not play safe.** Test ambitious
> intelligence claims with real, consented evidence while bounding privacy and
> accuracy risk. Full doctrine: [`THE-LAW.md`](../docs/THE-LAW.md).

Real statement fixtures are intentionally excluded from Git. Store consented, redacted files under `corpus/statement-fixtures/` and create `manifest.yaml` from `manifest.example.yaml`.

Run `npm run corpus` for a report at `output/corpus-report.json`. Before 100 consented real fixtures, the command reports collection progress. At 100 or more, it fails when precision is below 97% or recall is below 92%. `npm run corpus:strict` also fails while the corpus is below the threshold.

Rules:

- Record only an opaque `consentReference`; never put a user name, email, account number, or raw consent document in the manifest.
- Redact account/card identifiers, PAN, Aadhaar, IFSC, phone numbers, and handles before adding a fixture.
- Label generated examples `synthetic`. They test the harness but never count toward the 100-file release gate.
- Keep real fixtures in approved encrypted storage. The local corpus directory is ignored by Git and is not a production data store.