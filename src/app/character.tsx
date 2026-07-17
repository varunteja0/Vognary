import type { CSSProperties } from "react";

/**
 * Nakul — the Vognary mongoose.
 *
 * In Indian iconography Kubera, keeper of wealth, holds a mongoose that
 * guards treasure; the mongoose is also the one animal a snake fears.
 * Recurring charges are the snakes in the grass. Nakul sits upright,
 * watching the ledger, keeping the gold jewel — the same faceted diamond
 * as the Vognary mark — safe between his paws.
 *
 * The silhouette uses `currentColor` so it inherits surrounding text
 * colour; the eye and the jewel stay gold everywhere, forever.
 */

const GOLD = "#d8b87a";
const GOLD_HIGHLIGHT = "#efdcae";

export type NakulPose = "sentinel" | "guide" | "found" | "rest" | "celebrate";

export function Nakul({
  pose = "sentinel",
  size = 96,
  title,
  className,
  style,
}: {
  pose?: NakulPose;
  size?: number;
  title?: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      className={className}
      style={style}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {pose === "rest" ? <RestPose /> : (
        <g
          style={
            pose === "found"
              ? { transform: "rotate(-6deg)", transformOrigin: "50px 104px" }
              : undefined
          }
        >
          {/* Tail — curled around the base like a ground anchor */}
          <path
            d="M34 104 C20 104 10 95 12 82 C13.5 73 22 68.5 28 71.5 C24.5 73.5 21 77 21.5 82 C22.5 91 30 96 40 96 C37 99 35.5 102 34 104 Z"
            fill="currentColor"
          />
          {/* Body and head — upright, alert, leaning slightly forward */}
          <path
            d="M44 104 C33 104 27 95 27 84 C27 65 39 51 53 41 C58 37 62 30 64 24 C66 16.5 75 14.5 80 19.5 C83.5 23 84.5 28.5 82.5 32 L91 37 C86.5 43 78 45.5 72.5 45 C70 52 67.5 58 65.5 64 C62.5 74 60 84 58.5 94 L58.5 104 Z"
            fill="currentColor"
          />
          {/* Ear */}
          <path d="M73 18 C73.5 12.5 79.5 11 82 15.5 C80 17 76 18 73 18 Z" fill="currentColor" />
          {/* Guide pose — a paw raised toward what comes next */}
          {pose === "guide" ? (
            <path
              d="M64 62 C70 57.5 77 56.5 81.5 58 C81.5 61 77 64.5 70.5 65.5 C67 66 64.8 64.8 64 62 Z"
              fill="currentColor"
            />
          ) : null}
          {/* The watchful eye — gold, always */}
          <circle cx={pose === "found" ? 75.8 : 75.5} cy={27.5} r={pose === "found" ? 3.1 : 2.6} fill={GOLD} />
          <circle cx={76.4} cy={26.6} r={0.9} fill="#f6efdd" />
          {/* The jewel — the Vognary diamond, guarded between the paws */}
          {pose === "celebrate" ? (
            <>
              <path d="M49 66 L55.5 72.5 L49 79 L42.5 72.5 Z" fill={GOLD} />
              <path d="M49 66 L55.5 72.5 L42.5 72.5 Z" fill={GOLD_HIGHLIGHT} />
              <Spark x={31} y={58} s={3.2} />
              <Spark x={63} y={52} s={2.6} />
              <Spark x={38} y={44} s={2.2} />
            </>
          ) : (
            <>
              <path d="M70 91.5 L75.5 97 L70 102.5 L64.5 97 Z" fill={GOLD} />
              <path d="M70 91.5 L75.5 97 L64.5 97 Z" fill={GOLD_HIGHLIGHT} />
            </>
          )}
          {/* Found pose — the alert flick above the head */}
          {pose === "found" ? (
            <g stroke={GOLD} strokeWidth={2.4} strokeLinecap="round">
              <path d="M88 14 L91 8" />
              <path d="M95 20 L101 17" />
              <path d="M96 29 L102 30" />
            </g>
          ) : null}
        </g>
      )}
    </svg>
  );
}

function RestPose() {
  return (
    <g>
      {/* Curled loaf — body settled low over the ledger */}
      <path
        d="M34 92 C22 88 18 74 26 64 C34 54 52 50 68 54 C84 58 94 68 92 80 C90 90 78 95 62 95 C52 95 42 94.5 34 92 Z"
        fill="currentColor"
      />
      {/* Head resting on the body, snout tucked toward the paws */}
      <path
        d="M64 58 C66 50 76 47 82 52 C86 55.5 87 61 84 64 L92 69 C87 74 79 75.5 73 74 C69.5 70 66 64 64 58 Z"
        fill="currentColor"
      />
      {/* Ear */}
      <path d="M67 52 C67 47 73 45 76 49 C73.5 50.5 70 51.5 67 52 Z" fill="currentColor" />
      {/* Tail wrapped around the front, tip curled up */}
      <path
        d="M34 92 C22 96 10 92 8 82 C6.5 74 12 68 19 68 C15.5 71 13.5 75 15 79.5 C17 85.5 25 88 36 86 C35.2 88.2 34.5 90.2 34 92 Z"
        fill="currentColor"
      />
      {/* Closed eye — a calm gold arc */}
      <path d="M76 58.5 C78 60.5 81 60.5 83 58.5" stroke={GOLD} strokeWidth={2.2} strokeLinecap="round" fill="none" />
      {/* The jewel stays close, even asleep */}
      <path d="M50 100 L55 105 L50 110 L45 105 Z" fill={GOLD} />
      <path d="M50 100 L55 105 L45 105 Z" fill={GOLD_HIGHLIGHT} />
    </g>
  );
}

function Spark({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <path
      d={`M${x} ${y - s} L${x + s * 0.55} ${y} L${x} ${y + s} L${x - s * 0.55} ${y} Z`}
      fill={GOLD_HIGHLIGHT}
    />
  );
}

/** Head-only roundel for tight spots: loading states, avatars, list markers. */
export function NakulBadge({
  size = 28,
  title,
  className,
  pulse = false,
}: {
  size?: number;
  title?: string;
  className?: string;
  pulse?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={`${pulse ? "nakul-pulse " : ""}${className ?? ""}`}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <circle cx={24} cy={24} r={22.5} stroke="currentColor" strokeOpacity={0.28} strokeWidth={2} />
      <path
        d="M14 34 C14 25 18 19 24 15 C25.5 13.5 26.5 11 27.5 9 C29 5.5 34 5 36.5 8 C38.5 10.5 38.5 13.5 37 15.5 L42 18.5 C39 22.5 33.5 24 30 23.5 C27 28 25 31 24.5 34 Z"
        fill="currentColor"
      />
      <circle cx={33} cy={13.5} r={1.9} fill={GOLD} />
    </svg>
  );
}
