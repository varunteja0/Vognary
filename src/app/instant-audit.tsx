"use client";

import { useRef, useState } from "react";
import { formatMoney, formatShortDate } from "@/lib/format";
import type { InstantAuditResult } from "./instant-audit-engine";

type Engine = typeof import("./instant-audit-engine");

const rowStyle = { borderColor: "var(--dossier-line)", background: "rgba(243,234,214,0.04)" } as const;

export default function InstantAudit() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<InstantAuditResult | null>(null);
  const [stageFailed, setStageFailed] = useState(false);
  const engineRef = useRef<Engine | null>(null);
  const runSeq = useRef(0);

  async function loadEngine(): Promise<Engine> {
    engineRef.current ??= await import("./instant-audit-engine");
    return engineRef.current;
  }

  async function analyze(nextText: string) {
    const seq = ++runSeq.current;
    const engine = await loadEngine();
    if (seq !== runSeq.current) return;
    setResult(engine.analyzeInstant(nextText));
  }

  function onTextChange(value: string) {
    setText(value);
    setStageFailed(false);
    void analyze(value);
  }

  async function fillSample() {
    const engine = await loadEngine();
    onTextChange(engine.getSampleReceiptText().split(/\n\s*\n/).slice(0, 2).join("\n\n"));
  }

  async function continueToFullAudit() {
    const engine = await loadEngine();
    if (engine.stageForFullAudit(text)) {
      window.location.assign("/app");
      return;
    }
    setStageFailed(true);
  }

  return (
    <div>
      <label className="grid gap-2">
        <span className="font-data text-[0.62rem] uppercase tracking-[0.14em] muted-on-dark">Paste a receipt to see it now</span>
        <textarea
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          rows={4}
          placeholder="Paste a renewal email or invoice — merchant, amount, date."
          className="w-full resize-y rounded-[10px] border p-3 text-sm leading-6 text-(--dossier-ink) outline-none placeholder:text-(--dossier-muted) focus-visible:border-(--gold)"
          style={rowStyle}
        />
      </label>
      {result ? (
        <div role="region" aria-label="Instant audit result" aria-live="polite" className="mt-3 flex flex-col gap-2">
          {result.totals.map(([currency, amount]) => (
            <InstantMetric key={currency} label={result.totals.length === 1 ? "Monthly burn" : `Monthly total · ${currency}`} value={formatMoney(amount, currency)} />
          ))}
          <InstantMetric
            label="Next renewal"
            value={formatShortDate(result.nextRenewal.date)}
            detail={`${result.nextRenewal.merchant} · ${formatMoney(result.nextRenewal.amount, result.nextRenewal.currency)}`}
          />
          <InstantMetric label="Do this first" value={result.action.label} detail={result.action.merchant} />
          <button type="button" onClick={() => void continueToFullAudit()} className="btn btn-primary btn-block mt-2">
            Continue in the full audit
          </button>
          {stageFailed ? (
            <p role="status" className="text-xs leading-5 muted-on-dark">This tab could not stage the handoff — open the full audit and paste again there.</p>
          ) : null}
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-xs leading-5 muted-on-dark">
            {text.trim()
              ? "No recurring result yet — include the merchant, amount, and a renewal or billing date."
              : "Two receipts are enough for monthly burn, the next renewal, and one evidence-backed action."}
          </p>
          <button
            type="button"
            onClick={() => void fillSample()}
            className="self-start rounded-full border px-3 py-1 font-data text-[0.62rem] uppercase tracking-[0.14em] muted-on-dark transition hover:border-(--gold)"
            style={{ borderColor: "var(--dossier-line)" }}
          >
            Try a sample receipt
          </button>
        </div>
      )}
      <p className="mt-3 text-xs leading-5 muted-on-dark">Runs in this tab. Nothing leaves it unless you continue and choose to save.</p>
    </div>
  );
}

function InstantMetric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-[10px] border p-3" style={rowStyle}>
      <p className="font-data text-[0.6rem] uppercase tracking-[0.14em] muted-on-dark">{label}</p>
      <p className="mt-1 font-display text-lg font-semibold capitalize text-(--dossier-ink)">{value}</p>
      {detail ? <p className="mt-0.5 text-xs muted-on-dark">{detail}</p> : null}
    </div>
  );
}
