# Private receipt corpus gate

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
