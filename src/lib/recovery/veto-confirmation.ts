export const publicVetoOutcomes = [
  "vetoed",
  "already-vetoed",
  "expired",
  "invalid",
  "rate-limited",
  "unavailable",
] as const;

export type PublicVetoOutcome = (typeof publicVetoOutcomes)[number];

const titles: Record<PublicVetoOutcome, string> = {
  vetoed: "This Autopilot case is stopped",
  "already-vetoed": "This Autopilot case was already stopped",
  expired: "This veto link has expired",
  invalid: "This veto link cannot be used",
  "rate-limited": "Too many veto attempts",
  unavailable: "The veto could not be recorded just now",
};

const details: Record<PublicVetoOutcome, string> = {
  vetoed: "The case is withdrawn. This does not claim that anything was cancelled, connected, saved, or paid.",
  "already-vetoed": "The case was already withdrawn. This does not claim that anything was cancelled, connected, saved, or paid.",
  expired: "The signed veto window for this link has ended. Open the current notice if one still exists.",
  invalid: "This link is not a valid veto. No Autopilot case was changed.",
  "rate-limited": "Wait and try again from the same notice if you still need to stop the case.",
  unavailable: "Nothing was recorded. You can retry from the same notice.",
};

export function publicVetoRetryAllowed(outcome: PublicVetoOutcome): boolean {
  return outcome === "rate-limited" || outcome === "unavailable";
}

export function publicVetoConfirmationHtml(input: {
  outcome: PublicVetoOutcome;
}): string {
  const retry = publicVetoRetryAllowed(input.outcome)
    ? `<form method="post" action="" class="mt-6"><button type="submit" class="btn btn-primary">Try again</button></form>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(titles[input.outcome])}</title>
</head>
<body>
  <main class="mx-auto max-w-lg px-4 py-16">
    <h1>${escapeHtml(titles[input.outcome])}</h1>
    <p>${escapeHtml(details[input.outcome])}</p>
    ${retry}
  </main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
