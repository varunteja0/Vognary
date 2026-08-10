export type RedactionHit = {
  kind: string;
  count: number;
};

export type RedactionResult = {
  text: string;
  hits: RedactionHit[];
  redactedCount: number;
};

type RedactionRule = {
  kind: string;
  pattern: RegExp;
  replace: (match: string) => string;
};

// Order matters: card groups run before Aadhaar (a 16-digit card contains an
// Aadhaar-shaped prefix), and phone runs before the generic account rule so a
// 10-digit mobile number is not half-eaten as an account number.
const rules: RedactionRule[] = [
  {
    kind: "name",
    pattern: /\b(?:customer|account holder|cardholder|customer name|name)\s*[:\-]\s*[A-Z][A-Za-z .'-]{1,80}?(?=\s+(?:billing|shipping|address|invoice|receipt|merchant|amount|payment|charged|renews?|subscription)\b|[.;]|$)/gi,
    replace: (match) => `${match.slice(0, match.search(/[:\-]/) + 1)} NAME-REDACTED`,
  },
  {
    kind: "address",
    pattern: /\b(?:(?:billing|shipping|residential|postal)\s+)?address\s*[:\-]\s*.{3,160}?(?=\s+(?:invoice|receipt|merchant|amount|payment|charged|renews?|subscription)\b|[.;]|$)/gi,
    replace: (match) => `${match.slice(0, match.search(/[:\-]/) + 1)} ADDRESS-REDACTED`,
  },
  {
    kind: "card",
    pattern: /\b\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{1,7}\b/g,
    replace: (match) => `CARD-XX${match.replace(/\D/g, "").slice(-4)}`,
  },
  {
    kind: "aadhaar",
    pattern: /\b\d{4}\s\d{4}\s\d{4}\b/g,
    replace: () => "AADHAAR-REDACTED",
  },
  {
    kind: "pan",
    pattern: /\b[A-Z]{5}\d{4}[A-Z]\b/g,
    replace: () => "PAN-REDACTED",
  },
  {
    kind: "ifsc",
    pattern: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g,
    replace: () => "IFSC-REDACTED",
  },
  {
    kind: "phone",
    pattern: /(?:\+91[ -]?)?\b[6-9]\d{9}\b/g,
    replace: () => "PHONE-REDACTED",
  },
  {
    kind: "account",
    pattern: /\b\d{9,18}\b/g,
    replace: (match) => `ACCT-XX${match.slice(-4)}`,
  },
  {
    kind: "handle",
    pattern: /\b[\w.+-]{2,}@[a-z][a-z0-9.-]{1,24}\b/gi,
    replace: () => "HANDLE-REDACTED",
  },
];

// Strip personal identifiers from statement/receipt text while preserving the
// merchant, amount, and date signals the audit engine needs. Used before text
// leaves the workspace (exports, previews) — never claims to anonymize amounts.
export function redactText(input: string): RedactionResult {
  let text = input;
  const hits: RedactionHit[] = [];

  for (const rule of rules) {
    let count = 0;
    text = text.replace(rule.pattern, (match) => {
      count += 1;
      return rule.replace(match);
    });
    if (count > 0) hits.push({ kind: rule.kind, count });
  }

  return {
    text,
    hits,
    redactedCount: hits.reduce((total, hit) => total + hit.count, 0),
  };
}

export function redactLines(lines: string[]): { lines: string[]; redactedCount: number } {
  let redactedCount = 0;
  const redacted = lines.map((line) => {
    const result = redactText(line);
    redactedCount += result.redactedCount;
    return result.text;
  });
  return { lines: redacted, redactedCount };
}
