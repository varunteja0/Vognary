// India-first currency formatters extracted from vognary-mvp-client.tsx as part
// of the src/app/workspace/* decomposition (WP-B7). These are the money-display
// helpers the ledger, timeline, and brief panels all share — pulling them into a
// pure, dependency-free module is what lets those panels move out of the monolith
// without a circular import back into it.
//
// India-first invariant: INR renders in the Indian numbering system (en-IN →
// lakh/crore grouping) with the ₹ symbol; every other currency falls back to
// en-US grouping. `formatCurrency` shows whole rupees (no paise) because the
// audit surfaces are about recurring commitments, not cent-accurate ledgers;
// `formatMinorCurrency` keeps two fraction digits for minor-unit inputs (paise).

export function formatMinorCurrency(valueMinor: number, currency = "INR"): string {
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(valueMinor / 100);
}

export function formatCurrency(value: number, currency = "INR"): string {
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}
