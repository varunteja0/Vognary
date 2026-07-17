import { formatReceiptMoney, type SavingsReceipt } from "./savings-receipt";

/**
 * Savings share card — a 1200×630 SVG rendered entirely from the receipt.
 *
 * Pure string builder so it works in the browser (download / canvas-to-PNG)
 * and on the server identically. Uses system font stacks because the card
 * must rasterize without waiting on webfont loads; Nakul's celebrate pose is
 * inlined from src/app/character.tsx — keep the two in sync when the
 * character evolves.
 */

const GOLD = "#d8b87a";
const GOLD_HIGHLIGHT = "#efdcae";
const PAPER = "#0b0c0f";
const CARD = "#131519";
const INK = "#edeef1";
const MUTED = "#8a8e98";
const LINE = "rgba(255,255,255,0.10)";
const SERIF = "Georgia, 'Times New Roman', serif";
const MONO = "'SF Mono', 'Cascadia Mono', Menlo, Consolas, monospace";

export function buildSavingsCardSvg(receipt: SavingsReceipt): string {
  const amount = escapeXml(`${formatReceiptMoney(receipt.verifiedAnnual, receipt.currency)}/yr`);
  const commitments = receipt.verifiedCount === 1 ? "1 recurring charge" : `${receipt.verifiedCount} recurring charges`;
  const date = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" })
    .format(new Date(receipt.generatedAt));
  const topMerchants = receipt.entries.slice(0, 3).map((entry) => entry.merchant).join(" · ");

  return `<svg width="1200" height="630" viewBox="0 0 1200 630" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Vognary verified savings receipt">
  <rect width="1200" height="630" fill="${PAPER}"/>
  <rect x="40" y="40" width="1120" height="550" rx="28" fill="${CARD}" stroke="${LINE}"/>
  <g transform="translate(96, 96)">
    <path d="M7 11h17l5 7H12l-5-7ZM13 23h15l5 7H18l-5-7Z" fill="${INK}"/>
    <path d="M57 11H40l-5 7h17l5-7ZM51 23H36l-5 7h15l5-7Z" fill="${INK}"/>
    <path d="m20.5 35 11.5 14L43.5 35" stroke="${GOLD}" stroke-width="8" stroke-linecap="square" stroke-linejoin="miter"/>
    <path d="m23 35 9 11 9-11" stroke="${GOLD_HIGHLIGHT}" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter" opacity=".72"/>
    <text x="78" y="42" font-family="${SERIF}" font-size="34" font-weight="600" fill="${INK}">Vognary</text>
  </g>
  <text x="96" y="216" font-family="${MONO}" font-size="20" letter-spacing="4" fill="${GOLD}">VERIFIED SAVINGS RECEIPT</text>
  <text x="96" y="316" font-family="${SERIF}" font-size="96" font-weight="700" fill="${GOLD}">${amount}</text>
  <text x="96" y="372" font-family="${SERIF}" font-size="34" fill="${INK}">verifiably stopped leaving this account</text>
  <text x="96" y="424" font-family="${MONO}" font-size="20" fill="${MUTED}">${escapeXml(commitments)} · proven by evidence of absence · ${escapeXml(date)}</text>
  ${topMerchants ? `<text x="96" y="462" font-family="${MONO}" font-size="20" fill="${MUTED}">${escapeXml(truncate(topMerchants, 68))}</text>` : ""}
  <line x1="96" y1="502" x2="820" y2="502" stroke="${LINE}" stroke-width="2"/>
  <text x="96" y="544" font-family="${MONO}" font-size="20" fill="${INK}">Check any Vognary receipt at ${escapeXml(receipt.verifyUrl.replace(/^https?:\/\//, ""))}</text>
  <g transform="translate(880, 300) scale(2.2)">
    ${nakulCelebrateMarkup()}
  </g>
</svg>`;
}

/** Nakul, celebrate pose — mirrored from src/app/character.tsx. */
function nakulCelebrateMarkup(): string {
  return `
    <path d="M34 104 C20 104 10 95 12 82 C13.5 73 22 68.5 28 71.5 C24.5 73.5 21 77 21.5 82 C22.5 91 30 96 40 96 C37 99 35.5 102 34 104 Z" fill="${INK}"/>
    <path d="M44 104 C33 104 27 95 27 84 C27 65 39 51 53 41 C58 37 62 30 64 24 C66 16.5 75 14.5 80 19.5 C83.5 23 84.5 28.5 82.5 32 L91 37 C86.5 43 78 45.5 72.5 45 C70 52 67.5 58 65.5 64 C62.5 74 60 84 58.5 94 L58.5 104 Z" fill="${INK}"/>
    <path d="M73 18 C73.5 12.5 79.5 11 82 15.5 C80 17 76 18 73 18 Z" fill="${INK}"/>
    <circle cx="75.5" cy="27.5" r="2.6" fill="${GOLD}"/>
    <circle cx="76.4" cy="26.6" r="0.9" fill="#f6efdd"/>
    <path d="M49 66 L55.5 72.5 L49 79 L42.5 72.5 Z" fill="${GOLD}"/>
    <path d="M49 66 L55.5 72.5 L42.5 72.5 Z" fill="${GOLD_HIGHLIGHT}"/>
    <path d="M31 54.8 L32.76 58 L31 61.2 L29.24 58 Z" fill="${GOLD_HIGHLIGHT}"/>
    <path d="M63 49.4 L64.43 52 L63 54.6 L61.57 52 Z" fill="${GOLD_HIGHLIGHT}"/>
    <path d="M38 41.8 L39.21 44 L38 46.2 L36.79 44 Z" fill="${GOLD_HIGHLIGHT}"/>`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
