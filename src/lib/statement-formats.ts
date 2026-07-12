export type StatementFormatProfile = {
  id: string;
  institution: string;
  kind: "bank" | "card" | "generic";
  /** Normalized header names (lowercase, alphanumeric only) that identify this export. */
  signatureHeaders: string[];
  note?: string;
};

export type StatementFormatDetection = {
  profile: StatementFormatProfile | null;
  confidence: number;
  matchedHeaders: string[];
};

// Header fingerprints for common Indian bank/card statement exports. Detection
// labels the source and gives the user a parse-confidence signal; the actual
// column mapping still runs through the engine's synonym lists so an unknown
// format degrades gracefully instead of failing.
export const statementFormatProfiles: StatementFormatProfile[] = [
  {
    id: "hdfc-netbanking",
    institution: "HDFC Bank",
    kind: "bank",
    signatureHeaders: ["date", "narration", "valuedt", "withdrawalamt", "depositamt", "closingbalance"],
  },
  {
    id: "icici-netbanking",
    institution: "ICICI Bank",
    kind: "bank",
    signatureHeaders: ["transactiondate", "transactionremarks", "withdrawalamountinr", "depositamountinr", "balanceinr"],
  },
  {
    id: "sbi-netbanking",
    institution: "State Bank of India",
    kind: "bank",
    signatureHeaders: ["txndate", "valuedate", "description", "debit", "credit", "balance"],
  },
  {
    id: "axis-netbanking",
    institution: "Axis Bank",
    kind: "bank",
    signatureHeaders: ["trandate", "particulars", "debit", "credit", "balance"],
  },
  {
    id: "kotak-netbanking",
    institution: "Kotak Mahindra Bank",
    kind: "bank",
    signatureHeaders: ["transactiondate", "description", "debit", "credit", "balance"],
  },
  {
    id: "generic-card",
    institution: "Card statement",
    kind: "card",
    signatureHeaders: ["date", "description", "amount"],
    note: "Single amount column; debits inferred from sign and keywords.",
  },
  {
    id: "generic-bank",
    institution: "Bank export",
    kind: "generic",
    signatureHeaders: ["date", "description", "debit", "credit"],
  },
];

export function detectStatementFormat(rawHeaders: string[]): StatementFormatDetection {
  const normalized = new Set(rawHeaders.map(normalizeHeader).filter(Boolean));

  let best: StatementFormatDetection = { profile: null, confidence: 0, matchedHeaders: [] };

  for (const profile of statementFormatProfiles) {
    const matched = profile.signatureHeaders.filter((header) => normalized.has(header));
    const confidence = matched.length / profile.signatureHeaders.length;
    const beatsBest = confidence > best.confidence
      // Prefer the more specific profile when confidence ties (more signature headers matched).
      || (confidence === best.confidence && matched.length > best.matchedHeaders.length);
    if (beatsBest) {
      best = { profile, confidence, matchedHeaders: matched };
    }
  }

  if (best.confidence < 0.6) {
    return { profile: null, confidence: best.confidence, matchedHeaders: best.matchedHeaders };
  }
  return best;
}

export function describeStatementFormat(detection: StatementFormatDetection): string | null {
  if (!detection.profile) return null;
  const percent = Math.round(detection.confidence * 100);
  return `Detected ${detection.profile.institution} export format (${percent}% header match).`;
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}
