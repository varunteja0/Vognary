import type { ChangeItemDto, HomeProjectionDto } from "./contracts";

export function renderRecoveryShareText(home: HomeProjectionDto): string {
  const lines = ["Vognary renewal review"];
  if (home.monthlyTotals.length === 1) {
    lines.push(`Monthly burn from checked receipts: ${home.monthlyTotals[0].amount.display}/mo.`);
  } else if (home.monthlyTotals.length > 1) {
    lines.push("Monthly burn by currency from checked receipts:");
    for (const total of home.monthlyTotals) {
      lines.push(`${total.amount.currency}: ${total.amount.display}/mo.`);
    }
    lines.push("Currencies stay separate; no exchange rate was invented.");
  } else {
    lines.push("No monthly recurring total is published from these receipts.");
  }

  if (!home.monthlyTotals.length && home.recentObservations.length) {
    const label = home.recentObservations.length === 1
      ? "Saved receipt observation (not yet recurring)"
      : "Saved receipt observations (not yet recurring)";
    const observations = home.recentObservations.map(observationLabel);
    lines.push(`${label}: ${observations.join("; ")}.`);
  }

  if (home.changed.state === "COMPARED" && home.changed.items.length) {
    const changed = home.changed.items[0];
    lines.push(`Changed since last visit: ${changed.merchant} — ${changeLabel(changed)}.`);
  }

  const next = home.next[0];
  lines.push(next
    ? `Next expected charge: ${next.merchant} · ${next.amount.display} · ${formatDate(next.date)} (${formatDaysAway(next.daysAway)}).`
    : "No expected charge is published from these receipts.");

  const attention = home.needsMe[0];
  lines.push(attention
    ? `Needs attention: ${attention.title} — ${attention.detail}`
    : "No decision is waiting from the receipts checked.");

  const receipts = `${home.coverage.evidenceCount.toLocaleString("en-IN")} receipt${home.coverage.evidenceCount === 1 ? "" : "s"}`;
  const sources = `${home.coverage.sourceCount.toLocaleString("en-IN")} source${home.coverage.sourceCount === 1 ? "" : "s"}`;
  lines.push(`Coverage: ${receipts} from ${sources}. This is a floor from receipts checked, not every debit in India.`);
  lines.push("Every amount and expected date above comes from the saved Recovery projection; anything unsupported is left out.");

  return lines.join("\n");
}

function changeLabel(item: ChangeItemDto) {
  switch (item.kind) {
    case "ADDED": return "New recurring commitment";
    case "MERCHANT": return "Merchant changed";
    case "AMOUNT": return "Amount changed";
    case "DATE": return "Expected date changed";
    case "CADENCE": return "Cadence changed";
    case "RECURRING_CLASSIFICATION": return "Recurring status changed";
  }
}

function observationLabel(observation: HomeProjectionDto["recentObservations"][number]) {
  const facts = [observation.merchant ?? "Merchant not published"];
  if (observation.amount) facts.push(observation.amount.display);
  if (observation.date) facts.push(formatDate(observation.date));
  return facts.join(" · ");
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function formatDaysAway(daysAway: number) {
  if (daysAway === 0) return "today";
  if (daysAway === 1) return "tomorrow";
  if (daysAway < 0) return `${Math.abs(daysAway)} day${daysAway === -1 ? "" : "s"} ago`;
  return `in ${daysAway} days`;
}