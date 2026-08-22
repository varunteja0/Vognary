/**
 * Prefill confirm-the-line from already-readable text. Never invents money.
 * The user still has to confirm before the line becomes evidence.
 */
import { extractObservedReceipt } from "@/lib/receipt-parser";

export type ReceiptLineProposal = {
  merchant: string;
  amount: string;
  currency: string;
  date: string;
};

export type ImageProposalStatus = "idle" | "reading" | "ready" | "unreadable";

export function proposeReceiptLineFromReadableText(text: string): ReceiptLineProposal | null {
  const observed = extractObservedReceipt(text);
  if (!observed) return null;
  return {
    merchant: observed.merchant,
    amount: observed.amountDecimal,
    currency: observed.currency,
    date: observed.observedDate,
  };
}

export async function fetchReceiptLineProposal(file: File): Promise<ReceiptLineProposal | null> {
  const body = new FormData();
  body.append("file", file);
  try {
    const response = await fetch("/api/receipt-image/propose", {
      method: "POST",
      credentials: "same-origin",
      body,
    });
    if (!response.ok) return null;
    const payload = await response.json() as { proposal?: ReceiptLineProposal | null };
    const proposal = payload.proposal;
    if (!proposal) return null;
    return proposeReceiptLineFromReadableText(
      `${proposal.merchant} invoice paid ${proposal.currency} ${proposal.amount} on ${proposal.date}.`,
    );
  } catch {
    return null;
  }
}
