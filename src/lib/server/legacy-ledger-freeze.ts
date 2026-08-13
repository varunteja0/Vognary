import "server-only";

export const LEGACY_LEDGER_WRITE_FROZEN_MESSAGE =
  "Legacy living-ledger and connector_evidence writes are frozen. Recovery is the sole active ingestion authority.";

export class LegacyLedgerWriteFrozenError extends Error {
  readonly code = "LEGACY_LEDGER_WRITES_FROZEN" as const;

  constructor(message = LEGACY_LEDGER_WRITE_FROZEN_MESSAGE) {
    super(message);
    this.name = "LegacyLedgerWriteFrozenError";
  }
}

/** Always throws. Typed as void so call sites keep typechecking the frozen bodies. */
export function refuseLegacyLedgerWrite(): void {
  throw new LegacyLedgerWriteFrozenError();
}
