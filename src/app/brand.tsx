import type { CSSProperties } from "react";

/**
 * Vognary identity — "The Convergence".
 * Two platinum strokes funnel down and resolve into a single faceted gold
 * diamond — every recurring charge brought to one decision. Gold = money and
 * the verdict; the diamond = value resolved. The strokes use `currentColor` so
 * the mark inherits the surrounding text colour; the node stays gold.
 */

const GOLD = "#d8b87a";
const GOLD_HIGHLIGHT = "#efdcae";

export function VognaryMark({
  size = 28,
  title,
  className,
  style,
  animated = false,
  mono = false,
}: {
  size?: number;
  title?: string;
  className?: string;
  style?: CSSProperties;
  animated?: boolean;
  mono?: boolean;
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
        d="M11.5 13.5 21.7 29.6"
        pathLength={1}
        stroke="currentColor"
        strokeWidth={5}
        strokeLinecap="round"
      />
      <path
        d="M36.5 13.5 26.3 29.6"
        pathLength={1}
        stroke="currentColor"
        strokeWidth={5}
        strokeLinecap="round"
      />
      <path d="M24 26 29.4 31.8 24 37.6 18.6 31.8Z" fill={mono ? "currentColor" : GOLD} />
      <path d="M24 26 29.4 31.8 18.6 31.8Z" fill={mono ? "currentColor" : GOLD_HIGHLIGHT} />
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
