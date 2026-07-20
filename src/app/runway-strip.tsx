"use client";

import { useMemo, useState } from "react";
import { formatMoney, formatShortDate } from "@/lib/format";
import { primaryCurrency, type RecurringItem } from "@/lib/recurring-audit";
import { projectCashflow } from "@/lib/twin/project";
import { computeRunway } from "@/lib/twin/runway";

// The Financial Twin, surfaced. The monthly commitment is computed from proven
// evidence; the balance and income are figures the user types, and the copy
// says so plainly — the honesty rule holds even in the runway headline.
export function RunwayStrip({ items }: { items: RecurringItem[] }) {
  const [balance, setBalance] = useState("");
  const [income, setIncome] = useState("");

  const projection = useMemo(() => projectCashflow(items, { horizonDays: 365 }), [items]);
  const openingBalance = parseAmount(balance);
  const monthlyIncome = parseAmount(income) ?? 0;

  const runway = useMemo(
    () => (openingBalance === null ? null : computeRunway(projection, { openingBalance, monthlyIncome })),
    [projection, openingBalance, monthlyIncome],
  );

  const foreignCodes = Object.keys(projection.foreignTotals);

  return (
    <section aria-label="Cash runway" className="mt-5 rounded-2xl border border-line bg-card p-5 sm:p-7">
      <p className="font-data text-[0.64rem] uppercase tracking-[0.16em] text-verdict">Runway</p>
      <p className="mt-2 text-sm leading-6 text-(--ink-soft)">
        Your proven commitments come to{" "}
        <span className="font-semibold text-(--ink)">{formatMoney(projection.monthlyOutflow, primaryCurrency)}</span>{" "}
        a month. Enter today&apos;s balance to see how long that lasts.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className="field-label">Balance today · your figure</span>
          <input
            className="field"
            inputMode="decimal"
            value={balance}
            onChange={(event) => setBalance(event.target.value)}
            placeholder="50000"
            aria-label="Your balance today, in rupees"
          />
        </label>
        <label className="grid gap-1.5">
          <span className="field-label">Monthly income · optional</span>
          <input
            className="field"
            inputMode="decimal"
            value={income}
            onChange={(event) => setIncome(event.target.value)}
            placeholder="0"
            aria-label="Your monthly income, in rupees"
          />
        </label>
      </div>

      {runway ? (
        <div className="mt-4 rounded-xl border border-(--gold-line) bg-(--card-2) p-4" aria-live="polite">
          {runway.runwayDays === null ? (
            <p className="text-sm leading-6 text-(--ink)">
              On these figures you <span className="font-semibold">do not run out</span> within the next 12 months.
            </p>
          ) : (
            <p className="text-sm leading-6 text-(--ink)">
              On these figures your balance lasts about{" "}
              <span className="font-semibold">{formatRunwayMonths(runway.runwayMonths)}</span> — going negative around{" "}
              <span className="font-semibold">{formatShortDate(runway.firstNegativeDate ?? projection.today)}</span>.
            </p>
          )}
          <p className="mt-2 text-xs leading-5 text-(--muted)">
            Balance and income are the figures you entered; Vognary does not verify them. The monthly commitment is
            computed from your proven evidence.
          </p>
        </div>
      ) : null}

      {foreignCodes.length > 0 ? (
        <p className="mt-3 text-xs leading-5 text-(--muted)">
          Foreign renewals ({foreignCodes.join(", ")}) stay separate — Vognary will not invent an exchange rate to fold
          them into a rupee runway.
        </p>
      ) : null}
    </section>
  );
}

function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}

function formatRunwayMonths(months: number | null): string {
  if (months === null) return "—";
  if (months < 1) return "under a month";
  const rounded = Math.round(months * 10) / 10;
  return `${rounded} month${rounded >= 2 ? "s" : ""}`;
}
