# Private receipt corpus gate

> **Operating sequence: Make it work. Make it perfect. Make it fast. Make it cheap.**
> **Strategy rule: Take smart risks. Do not play safe.** Test ambitious parser
> claims quickly, but never trade away consent, redaction, provenance, or the
> precision and recall kill gates. Full doctrine: [`THE-LAW.md`](THE-LAW.md).

The receipt-quality launch gate uses 200 consented, redacted real receipts stored outside Git. Raw receipt text, manifest consent references, and generated reports must remain in approved private storage.

Place the working corpus at `corpus/receipt-fixtures/` (or set `RECEIPT_CORPUS_DIR`) with a `manifest.yaml` using this shape:

```yaml
version: 1
fixtures:
  - file: receipt-001.txt
    channel: email
    provenance: consented-redacted-real
    consentReference: consent-opaque-reference
    expected:
      candidates:
        - merchant: Example Merchant
          amount: 999
          currency: INR
          frequency: monthly
          nextExpectedDate: 2026-08-01
```

Run `npm run receipt-corpus` while collecting. Before launch, `npm run receipt-corpus:strict` must report at least 200 real fixtures, precision of at least 97%, recall of at least 92%, and p95 first-result time below five seconds. Reports contain only fixture identifiers, scores, and timings and are written to the ignored `output/` directory.
