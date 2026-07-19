// The one shared sample dataset, used by both the signed-out guest audit and
// the signed-in "See a sample audit" seed so the demo is identical everywhere.
// Eight realistic INR subscriptions written as receipt text; they run through
// the same deterministic parser as real pasted evidence — no special path.
export const sampleReceiptText = [
  "OpenAI invoice paid INR 1,999 on 2026-07-06. ChatGPT Plus renews monthly.",
  "Notion invoice paid INR 830 on 2026-07-01. Notion Plus renews monthly.",
  "Netflix subscription paid INR 649 on 2026-06-17. Renews monthly.",
  "Spotify Premium receipt paid INR 119 on 2026-07-05. Renews monthly.",
  "Google One subscription paid INR 130 on 2026-07-01. Renews monthly.",
  "Canva subscription paid INR 499 on 2026-07-03. Renews monthly.",
  "Amazon Prime subscription paid INR 1,499 on 2026-07-10. Renews yearly.",
  "Adobe subscription paid INR 1,675 on 2026-07-12. Renews monthly.",
].join("\n\n");

// A workspace is "sample mode" when its only evidence is exactly this sample
// text (no real manual items or statements). Content-derived so the banner
// survives reload without persisting a separate flag.
export function isSampleReceiptText(receiptText: string): boolean {
  return receiptText.trim() === sampleReceiptText.trim();
}
