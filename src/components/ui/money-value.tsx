import type { MoneyDto, ProjectionAmountProvenance } from "@/lib/recovery/contracts";
import { currencyExponent } from "@/lib/recovery/domain";

/**
 * Where a number came from. Required, so a money value cannot render without
 * declaring its provenance — the distinction this product sells.
 *
 * cited     — backed by a receipt or bill the user supplied
 * assumed   — typed by a human; a claim, not proof
 * projected — expected from cited history, but not yet charged
 * frozen    — recorded by a human decision; immovable afterwards. `label`
 *             separates the amount frozen at decision from the cap itself.
 * observed  — later evidence, measured against a cap
 * unknown   — not yet known; renders as an em dash, never as zero
 */
export type MoneyProvenance =
  | { kind: "cited"; source: string }
  | { kind: "assumed" }
  | { kind: "projected" }
  | { kind: "frozen"; label?: string }
  | { kind: "observed" }
  | { kind: "unknown"; reason?: string };

/** Maps the projection's own provenance so call sites do not restate it. */
export function citedFrom(provenance: ProjectionAmountProvenance): MoneyProvenance {
  return { kind: "cited", source: provenance === "USER_CORRECTED" ? "Corrected" : "Receipt" };
}

type MoneyValueOwnProps = {
  provenance: MoneyProvenance;
  size?: "data" | "record" | "lead";
  /** "stacked" puts provenance under the amount, for column layouts. */
  layout?: "inline" | "stacked";
  /** Plays the proving transition when a claim becomes evidence. */
  proving?: boolean;
  className?: string;
};

/**
 * Three input shapes, one renderer:
 *   display — the server's own formatted string, rendered verbatim (preferred;
 *             the client must never reformat a server amount)
 *   amount  — a MoneyDto, whose `display` is likewise used verbatim
 *   minor   — raw minor units, formatted client-side for surfaces the server
 *             does not pre-format (Commitment Control)
 */
type MoneyValueProps = MoneyValueOwnProps &
  (
    | { display: string; amount?: never; minor?: never; currency?: never }
    | { display?: never; amount: MoneyDto; minor?: never; currency?: never }
    | { display?: never; amount?: never; minor: string | null; currency?: string }
  );

export function MoneyValue({
  display,
  amount,
  minor,
  currency = "INR",
  provenance,
  size = "record",
  layout = "inline",
  proving = false,
  className = "",
}: MoneyValueProps) {
  const base = `money money-${size} money-${layout} ${proving ? "money-proving" : ""} ${className}`
    .replace(/\s+/g, " ")
    .trim();

  const missing = display === undefined && !amount && minor === null;

  // An unknown amount must never be coerced into a number.
  if (provenance.kind === "unknown" || missing) {
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

  const text =
    display ??
    amount?.display ??
    formatExactMinor(minor as string, currencyExponent(currency), currency);

  return (
    <span className={`money-${provenance.kind} ${base}`}>
      <span className="money-amount">{text}</span>
      <span className="money-provenance">{provenanceLabel(provenance)}</span>
    </span>
  );
}

/**
 * The one exact renderer for minor units the server does not pre-format
 * (Commitment Control). Exported so no surface invents a second notation for
 * the same figure — a cap shown as "INR 1,350" in the ledger and "₹1,350.00" in
 * the dialog beside it is two representations of one number.
 */
export function formatExactMinorUnits(minor: string, currency: string): string {
  return formatExactMinor(minor, currencyExponent(currency), currency);
}

function formatExactMinor(minor: string, exponent: number, currency: string): string {
  const value = BigInt(minor);
  const zero = BigInt(0);
  const negative = value < zero;
  const absolute = negative ? -value : value;
  const divisor = BigInt(10) ** BigInt(exponent);
  return compose(negative, absolute / divisor, absolute % divisor, exponent, currency);
}

/**
 * Fraction digits appear only when they carry information — "INR 1,350" rather
 * than "INR 1,350.00" — and the ISO code is always shown, never a bare symbol.
 * INR uses Indian (lakh/crore) grouping.
 */
function compose(
  negative: boolean,
  whole: bigint,
  fraction: bigint,
  exponent: number,
  currency: string,
): string {
  const grouped = new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    maximumFractionDigits: 0,
  }).format(whole);
  const fractionText =
    fraction === BigInt(0) ? "" : `.${String(fraction).padStart(exponent, "0")}`;
  return `${negative ? "−" : ""}${currency} ${grouped}${fractionText}`;
}

function provenanceLabel(provenance: MoneyProvenance): string {
  switch (provenance.kind) {
    case "cited":
      return provenance.source;
    case "assumed":
      return "Assumption";
    case "projected":
      return "Not charged yet";
    case "frozen":
      return provenance.label ?? "Frozen";
    case "observed":
      return "Observed";
    default:
      return "Not yet known";
  }
}
