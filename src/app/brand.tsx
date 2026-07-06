import type { CSSProperties } from "react";

/**
 * Vognary identity — "The Resolve".
 * A geometric V whose strokes converge into a single gold node: every
 * recurring charge, brought to one clear verdict. Gold = money / decision.
 * The V uses `currentColor` so it inherits the surrounding text colour;
 * the node is the brand's constant champagne gold.
 */

const GOLD = "#d8b87a";
const GOLD_HIGHLIGHT = "#efdcae";

export function VognaryMark({
  size = 28,
  title,
  className,
  style,
  animated = false,
}: {
  size?: number;
  title?: string;
  className?: string;
  style?: CSSProperties;
  animated?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={`${animated ? "mark-draw " : ""}${className ?? ""}`}
      style={style}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <path
        d="M13 14 24 34 35 14"
        pathLength={1}
        stroke="currentColor"
        strokeWidth={5.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="24" cy="34" r="4" fill={GOLD} />
      <circle cx="22.6" cy="32.7" r="1.15" fill={GOLD_HIGHLIGHT} />
    </svg>
  );
}

export function VognaryLockup({
  markSize = 24,
  className,
  wordClassName,
}: {
  markSize?: number;
  className?: string;
  wordClassName?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <VognaryMark size={markSize} />
      <span className={`font-display font-semibold tracking-[-0.02em] ${wordClassName ?? ""}`}>
        Vognary
      </span>
    </span>
  );
}
