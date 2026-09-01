import { currencyExponent } from "@/lib/recovery/domain";

/**
 * Where a number came from. Required, so a money value cannot render without
 * declaring its provenance — the distinction this product sells.
 *
 * cited    — backed by a receipt or bill the user supplied
 * assumed  — typed by a human; a claim, not proof
 * frozen   — a human-authorized cap; immovable once recorded
 * observed — later evidence, measured against a cap
 * unknown  — not yet known; renders as an em dash, never as zero
 */
export type MoneyProvenance =
  | { kind: "cited"; source: string }
  | { kind: "assumed" }
  | { kind: "frozen" }
  | { kind: "observed" }
  | { kind: "unknown"; reason?: string };

export function MoneyValue({
  minor,
  currency = "INR",
  provenance,
  size = "record",
  layout = "inline",
  className = "",
}: {
  /** Minor units (paise for INR). Never a pre-divided major-unit float. */
  minor: number | null;
  currency?: string;
  provenance: MoneyProvenance;
  size?: "data" | "record" | "lead";
  /** "stacked" puts provenance under the amount, for column layouts. */
  layout?: "inline" | "stacked";
  className?: string;
}) {
  const base = `money money-${size} money-${layout} ${className}`.trim();

  // An unknown amount must never be coerced into a number.
  if (provenance.kind === "unknown" || minor === null) {
    const reason = provenance.kind === "unknown" ? provenance.reason : undefined;
    return (
      <span className={`money-unknown ${base}`}>
        <span className="money-amount" aria-hidden="true">
          —
        </span>
        <span className="money-provenance">{reason ?? "Not yet known"}</span>
      </span>
    );
  }

  return (
    <span className={`money-${provenance.kind} ${base}`}>
      <span className="money-amount">{formatExactMinor(minor, currency)}</span>
      <span className="money-provenance">{provenanceLabel(provenance)}</span>
    </span>
  );
}

/**
 * Formats exact minor units without floating-point division: the whole and
 * fractional parts are split with integer math, so a value never drifts.
 * Fraction digits appear only when they carry information — "INR 1,350" rather
 * than "INR 1,350.00" — and the ISO code is always shown, never a bare symbol.
 * INR uses Indian (lakh/crore) grouping.
 */
function formatExactMinor(minor: number, currency: string): string {
  const exponent = currencyExponent(currency);
  const divisor = 10 ** exponent;
  const rounded = Math.round(minor);
  const negative = rounded < 0;
  const absolute = Math.abs(rounded);
  const whole = Math.trunc(absolute / divisor);
  const fraction = absolute - whole * divisor;
  const grouped = new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    maximumFractionDigits: 0,
  }).format(whole);
  const fractionText = fraction === 0 ? "" : `.${String(fraction).padStart(exponent, "0")}`;
  return `${negative ? "−" : ""}${currency} ${grouped}${fractionText}`;
}

function provenanceLabel(provenance: MoneyProvenance): string {
  switch (provenance.kind) {
    case "cited":
      return provenance.source;
    case "assumed":
      return "Assumption";
    case "frozen":
      return "Frozen cap";
    case "observed":
      return "Observed";
    default:
      return "Not yet known";
  }
}
