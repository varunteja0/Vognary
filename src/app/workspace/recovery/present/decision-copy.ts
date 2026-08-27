/**
 * Presentation-only decision-moment copy. Does not rank, invent, or
 * reconstruct financial facts — it only phrases already-cited fields.
 */

export function citedEvidenceLine(evidenceCount: number): string {
  if (evidenceCount <= 0) return "No cited receipt is attached yet.";
  if (evidenceCount === 1) return "Based on 1 cited receipt.";
  return `Based on ${evidenceCount.toLocaleString("en-IN")} cited receipts.`;
}

export function chargeWhenLine(
  dueDate: string | null,
  daysAway: number | null,
  formattedDay: string | null,
): string {
  if (!dueDate || !formattedDay) return "Date not established";
  if (daysAway === 0) return `Charges today · ${formattedDay}`;
  if (daysAway === 1) return `Charges tomorrow · ${formattedDay}`;
  if (daysAway !== null && daysAway > 1) {
    return `Charges in ${daysAway.toLocaleString("en-IN")} days · ${formattedDay}`;
  }
  return `Charges ${formattedDay}`;
}

export function chargeDueDisplay(formattedDay: string | null, daysAway: number | null): string | null {
  if (!formattedDay) return null;
  if (daysAway === 0) return `${formattedDay} · today`;
  if (daysAway === 1) return `${formattedDay} · tomorrow`;
  if (daysAway !== null && daysAway > 1) return `${formattedDay} · in ${daysAway.toLocaleString("en-IN")} days`;
  return formattedDay;
}
