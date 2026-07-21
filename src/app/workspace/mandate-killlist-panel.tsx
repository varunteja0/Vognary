"use client";

import { useMemo } from "react";
import { formatMoney, formatShortDate } from "@/lib/format";
import type { RecurringItem } from "@/lib/recurring-audit";
import { buildMandateKillList, type MandateKill } from "@/lib/mandate-killlist";

// The UPI mandate kill-list, rendered. For every recurring charge pulled over an
// Indian auto-debit rail (UPI AutoPay, card e-mandate, NACH/ECS, SI), it shows
// where the mandate is actually revoked — because cancelling at the merchant
// leaves the mandate alive. Every card carries the exact statement token it was
// classified from, so the claim is checkable against the line.
export function MandateKillListPanel({ items, onSelect }: { items: RecurringItem[]; onSelect?: (itemId: string) => void }) {
  const kills = useMemo(() => buildMandateKillList(items), [items]);
  if (kills.length === 0) return null;

  return (
    <section aria-label="Auto-debit mandate kill-list" className="rounded-2xl border border-(--gold-line) bg-(--dossier-fill) p-5 sm:p-7">
      <p className="font-data text-[0.64rem] uppercase tracking-[0.16em] text-gold">Kill-list · auto-debit mandates</p>
      <h2 className="mt-2 font-display text-xl leading-snug text-(--ink) sm:text-2xl">
        {kills.length} {kills.length === 1 ? "mandate keeps" : "mandates keep"} pulling until you revoke {kills.length === 1 ? "it" : "them"}
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-(--ink-soft)">
        In India the auto-debit lives at your bank or UPI app, not the merchant. Cancelling the subscription does not
        stop the debit — the mandate does.
      </p>

      <ul className="mt-5 grid gap-3">
        {kills.map((kill) => (
          <li key={kill.itemId}>
            <KillCard kill={kill} onSelect={onSelect} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function KillCard({ kill, onSelect }: { kill: MandateKill; onSelect?: (itemId: string) => void }) {
  return (
    <div className="rounded-xl border border-line bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex items-center gap-2">
          <MerchantName kill={kill} onSelect={onSelect} />
          <RailChip label={kill.railLabel} />
        </div>
        <span className="font-data text-sm text-(--ink-soft)">
          {formatMoney(kill.amount, kill.currency)} · next {formatShortDate(kill.nextExpectedDate)}
        </span>
      </div>

      <p className="mt-2 text-sm leading-5 text-ember">{kill.warning}</p>

      <p className="mt-3 field-label">
        How to revoke {kill.pspHint ? <span className="text-gold">· {kill.pspHint}</span> : null}
      </p>
      <ol className="mt-1.5 grid gap-1 text-sm leading-6 text-(--ink-soft)">
        {kill.revoke.steps.map((step, index) => (
          <li key={step}>{index + 1}. {step}</li>
        ))}
      </ol>
      {kill.revoke.caveat ? <p className="mt-2 text-xs leading-5 text-(--muted)">{kill.revoke.caveat}</p> : null}

      {kill.merchantCancel?.manageUrl ? (
        <a href={kill.merchantCancel.manageUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm font-semibold text-(--ink) underline underline-offset-4">
          Also cancel at {kill.merchantCancel.merchantLabel} ↗
        </a>
      ) : null}

      <p className="mt-3 font-data text-[0.62rem] leading-4 text-(--muted)">
        Matched “{kill.matchedText}” in your statement — that is why this is a {kill.railLabel.toLowerCase()}.
      </p>
    </div>
  );
}

function MerchantName({ kill, onSelect }: { kill: MandateKill; onSelect?: (itemId: string) => void }) {
  if (!onSelect) return <span className="font-display text-lg font-semibold text-(--ink)">{kill.merchant}</span>;
  return (
    <button type="button" onClick={() => onSelect(kill.itemId)} className="font-display text-lg font-semibold text-(--ink) transition hover:text-(--gold-soft)">
      {kill.merchant}
    </button>
  );
}

function RailChip({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-(--gold-line) px-2 py-0.5 font-data text-[0.6rem] uppercase tracking-[0.12em] text-gold">
      {label}
    </span>
  );
}
