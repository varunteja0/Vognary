import { createHash } from "node:crypto";

export type RecoveryEvidenceFingerprintInput = {
  sourceId: string;
  evidenceKind: "TRANSACTION" | "RECEIPT";
  rowNumber: number;
  normalizedMerchant: string;
  amountMinor: string | null;
  currency: string | null;
  evidenceDate: string | null;
  direction: string | null;
  cadenceHint: string | null;
  nextExpectedDate: string | null;
};

export function recoveryEvidenceFingerprint(input: RecoveryEvidenceFingerprintInput) {
  const identity = input.evidenceKind === "RECEIPT"
    ? [
        "receipt-fact-v1",
        normalizeText(input.normalizedMerchant),
        input.amountMinor,
        input.currency,
        input.evidenceDate,
        input.cadenceHint,
        input.nextExpectedDate,
      ]
    : [
        "transaction-row-v1",
        input.sourceId,
        input.rowNumber,
        normalizeText(input.normalizedMerchant),
        input.amountMinor,
        input.currency,
        input.evidenceDate,
        input.direction,
      ];
  return createHash("sha256").update(identity.map((value) => value ?? "").join("\0")).digest("hex");
}

function normalizeText(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}