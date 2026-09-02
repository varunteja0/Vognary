"use client";

import { useEffect, useRef } from "react";
import { formatExactMinorUnits, MoneyValue } from "@/components/ui/money-value";
import {
  authorityFieldModel,
  type AuthorityFieldStage,
} from "@/lib/authority-field";
import type { SyntheticDemoBranch } from "@/lib/synthetic-control-demo";
import "./authority-field.css";

/**
 * THE AUTHORITY FIELD
 *
 * One vertical value axis carries the whole product. A proposal is not a card —
 * it is an unstable region between what is already proven and what is being
 * asked for. Policy draws a ceiling across the region but visibly cannot close
 * it. A named human collapses the region to a single gold line. Later evidence
 * arrives from the right and lands somewhere relative to that line, which never
 * moves again.
 *
 * The collapse is the one decisive motion in the product and is used nowhere
 * else. It is a single compositor-only transform, so the freeze cannot stutter.
 */

type AuthorityFieldProps = {
  stage: AuthorityFieldStage;
  branch: SyntheticDemoBranch;
  /** Labelled by the surface that owns the heading, so the field never invents one. */
  labelledBy: string;
};

const STAGE_CAPTION: Record<AuthorityFieldStage, string> = {
  EVIDENCE: "Two charges are already proven. Nothing has been asked for yet.",
  PROPOSED: "A request opens an unsettled region above what the record proves.",
  POLICY: "Policy draws a ceiling across the region. It marks; it cannot close.",
  AUTHORIZED: "A named person collapses the region to one boundary. It will not move.",
  OBSERVED: "The later receipt arrives and lands relative to that boundary.",
  REFUSED: "The request was refused. No boundary exists, so nothing measures against one.",
};

export function AuthorityField({ stage, branch, labelledBy }: AuthorityFieldProps) {
  const model = authorityFieldModel(stage, branch);
  const plot = useRef<HTMLDivElement>(null);

  // The unsettled region is the only thing in the product allowed to keep
  // moving, because "not yet decided" is a live state. It stops paying for
  // itself the moment it is off screen, and it stops forever once a human
  // decides.
  useEffect(() => {
    const element = plot.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries[entries.length - 1]?.isIntersecting ?? true;
      element.dataset.inView = visible ? "true" : "false";
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const settled = stage === "AUTHORIZED" || stage === "OBSERVED" || stage === "REFUSED";
  const bandFloor = settled && model.boundary ? model.boundary.position : model.band.floor;
  const bandRoof = settled && model.boundary ? model.boundary.position : model.band.roof;
  const bandVisible = stage !== "EVIDENCE";

  return (
    <figure className="afield" data-stage={stage} data-branch={branch} aria-labelledby={labelledBy}>
      <div className="afield-plot" ref={plot} data-in-view="true">
        <div className="afield-axis" aria-hidden="true" />
        <div className="afield-graduations" aria-hidden="true" />

        {/* At the start of every commitment this is the true state of the world:
            one proven line, and above it nothing. */}
        <div
          className="afield-unknown"
          style={{ "--y": model.cited[0]?.position ?? 0 } as React.CSSProperties}
          aria-hidden="true"
        >
          <span>Above this line, nothing is known yet</span>
        </div>

        <div
          className="afield-zone"
          style={{ "--y": model.limit.position } as React.CSSProperties}
          aria-hidden="true"
        />

        <div
          className="afield-band"
          data-visible={bandVisible ? "true" : "false"}
          style={{
            "--floor": bandFloor,
            "--scale": Math.max((bandRoof - bandFloor) / 100, 0),
          } as React.CSSProperties}
          aria-hidden="true"
        />

        {model.boundary ? (
          <div
            className="afield-boundary"
            style={{ "--y": model.boundary.position } as React.CSSProperties}
            aria-hidden="true"
          />
        ) : null}

        {model.observed ? (
          <div
            className="afield-observed-line"
            data-verdict={model.verdict ?? undefined}
            style={{ "--y": model.observed.position } as React.CSSProperties}
            aria-hidden="true"
          />
        ) : null}

        {model.observed && model.boundary ? (
          <div
            className="afield-gap"
            data-verdict={model.verdict ?? undefined}
            style={{
              "--from": Math.min(model.boundary.position, model.observed.position),
              "--to": Math.max(model.boundary.position, model.observed.position),
            } as React.CSSProperties}
            aria-hidden="true"
          />
        ) : null}

        <ol className="afield-marks">          <li className="afield-cited-group" style={{ "--y": model.cited[0]?.position ?? 0 } as React.CSSProperties}>
            <ul className="afield-ticks">
              {model.cited.map((mark) => (
                <li key={mark.id}>
                  <span className="afield-tick" aria-hidden="true" />
                  <span className="afield-tick-label">{mark.label.replace(" charge", "")}</span>
                </li>
              ))}
            </ul>
            <p className="afield-mark-name">Proven by receipt</p>
            <MoneyValue
              minor={model.cited[0]?.minor ?? null}
              currency={model.currency}
              provenance={{ kind: "cited", source: "Invoice" }}
              size="data"
            />
            <p className="afield-mark-detail">
              {model.cited.length} vendor invoices at the same amount. This is the only thing here that is proven.
            </p>
          </li>

          <Mark
            hidden={stage === "EVIDENCE"}
            lane="right"
            y={model.band.roof}
            name="Requested"
            className="afield-mark-request"
            detail="Typed by a person. An assumption until someone with authority decides."
          >
            <MoneyValue
              minor={model.band.requestMinor}
              currency={model.currency}
              provenance={{ kind: "assumed" }}
              size="data"
            />
          </Mark>

          <Mark
            hidden={stage === "EVIDENCE" || stage === "PROPOSED"}
            lane="zone"
            y={model.limit.position}
            name="Outside policy above here"
            className="afield-mark-limit"
            detail={model.limit.detail}
          >
            {/* A configured ceiling is a rule, not an amount with provenance, so it
                is rendered as the exact figure it is rather than dressed as evidence. */}
            <p className="afield-rule-amount font-data tnum">
              {formatExactMinorUnits(model.limit.minor, model.currency)}
            </p>
          </Mark>

          {model.boundary ? (
            <Mark
              hidden={false}
              lane="left"
              y={model.boundary.position}
              name="Authorized boundary"
              className="afield-mark-boundary"
              detail={model.boundary.detail}
            >
              <MoneyValue
                minor={model.boundary.minor}
                currency={model.boundary.currency}
                provenance={{ kind: "frozen", label: "Frozen cap" }}
                size="record"
              />
            </Mark>
          ) : null}

          {model.observed ? (
            <Mark
              hidden={false}
              lane="right"
              y={model.observed.position}
              name="Observed charge"
              className="afield-mark-observed"
              detail={model.observed.detail}
            >
              <MoneyValue
                minor={model.observed.minor}
                currency={model.observed.currency}
                provenance={{ kind: "observed" }}
                size="record"
              />
            </Mark>
          ) : null}
        </ol>
      </div>

      <figcaption className="afield-caption" aria-live="polite">
        <span className="afield-caption-stage">{stageName(stage)}</span>
        <span className="afield-caption-text">{STAGE_CAPTION[stage]}</span>
      </figcaption>
    </figure>
  );
}

function stageName(stage: AuthorityFieldStage): string {
  if (stage === "EVIDENCE") return "Proven";
  if (stage === "PROPOSED") return "Requested";
  if (stage === "POLICY") return "Marked by policy";
  if (stage === "AUTHORIZED") return "Authorized";
  if (stage === "REFUSED") return "Refused";
  return "Reconciled";
}

function Mark({
  hidden,
  lane,
  y,
  name,
  detail,
  className,
  children,
}: {
  hidden: boolean;
  lane: "left" | "right" | "zone";
  y: number;
  name: string;
  detail: string;
  className: string;
  children: React.ReactNode;
}) {
  if (hidden) return null;
  return (
    <li className={`afield-mark ${className}`} data-lane={lane} style={{ "--y": y } as React.CSSProperties}>
      <span className="afield-mark-rule" aria-hidden="true" />
      <p className="afield-mark-name">{name}</p>
      {children}
      <p className="afield-mark-detail">{detail}</p>
    </li>
  );
}
