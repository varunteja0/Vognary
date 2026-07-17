import type { CSSProperties } from "react";

/**
 * Vognary identity — "Ledger to Verdict".
 * Two tiers of evidence rows converge into one gold V: scattered recurring
 * commitments become a single, reviewable action. The rows inherit the
 * surrounding text colour; the verdict stays champagne gold.
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
      viewBox="0 0 64 64"
      fill="none"
      className={`${animated ? "mark-draw " : ""}${className ?? ""}`}
      style={style}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <path
        className="mark-source mark-source-left"
        d="M7 11h17l5 7H12l-5-7ZM13 23h15l5 7H18l-5-7Z"
        fill="currentColor"
      />
      <path
        className="mark-source mark-source-right"
        d="M57 11H40l-5 7h17l5-7ZM51 23H36l-5 7h15l5-7Z"
        fill="currentColor"
      />
      <path
        className="mark-verdict"
        d="m20.5 35 11.5 14L43.5 35"
        stroke={mono ? "currentColor" : GOLD}
        strokeWidth={8}
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
      {!mono ? (
        <path
          className="mark-verdict mark-verdict-highlight"
          d="m23 35 9 11 9-11"
          stroke={GOLD_HIGHLIGHT}
          strokeWidth={2}
          strokeLinecap="square"
          strokeLinejoin="miter"
          opacity={0.72}
        />
      ) : null}
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
