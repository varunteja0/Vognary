/**
 * A citation you can inspect without leaving the page.
 *
 * Evidence is the product's whole claim, so a chip is a real control — never
 * decoration. When there is no evidence it says so plainly rather than
 * disappearing, because a missing citation is information.
 */
export function EvidenceChip({
  label,
  detail,
  onInspect,
  href,
}: {
  /** What the evidence is, e.g. "Aug receipt". */
  label: string;
  /** Optional qualifier shown after a separator, e.g. "PDF · 2 pages". */
  detail?: string;
  /** Opens the evidence in place. Preferred over navigating away. */
  onInspect?: () => void;
  /** Used only when the evidence genuinely lives at another URL. */
  href?: string;
}) {
  const body = (
    <>
      <span className="evidence-chip-mark" aria-hidden="true" />
      <span className="evidence-chip-label">{label}</span>
      {detail ? <span className="evidence-chip-detail">{detail}</span> : null}
    </>
  );

  if (onInspect) {
    return (
      <button type="button" className="evidence-chip" onClick={onInspect}>
        {body}
      </button>
    );
  }
  if (href) {
    return (
      <a className="evidence-chip" href={href}>
        {body}
      </a>
    );
  }
  return <span className="evidence-chip evidence-chip-static">{body}</span>;
}

/** States the absence of evidence, rather than rendering nothing. */
export function NoEvidenceChip({ reason = "No citation yet" }: { reason?: string }) {
  return (
    <span className="evidence-chip evidence-chip-absent">
      <span className="evidence-chip-mark" aria-hidden="true" />
      <span className="evidence-chip-label">{reason}</span>
    </span>
  );
}
