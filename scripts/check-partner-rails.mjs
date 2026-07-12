const allowedValues = ["outreach-started", "sandbox-requested", "sandbox-approved", "production-live"];
const rails = [
  { rail: "accountAggregator", envVar: "ACCOUNT_AGGREGATOR_PARTNER_STATUS" },
  { rail: "upiMandates", envVar: "UPI_MANDATE_PARTNER_STATUS" },
  { rail: "cardMandates", envVar: "CARD_MANDATE_PARTNER_STATUS" },
];

if (process.argv.includes("--help")) {
  console.log(`Validate AA / UPI / card mandate partner rail readiness env values.\n\nAllowed values:\n  ${allowedValues.join(" | ")}\n\nStrict moat readiness requires all three env vars to be production-live.`);
  process.exit(0);
}

const report = rails.map(({ rail, envVar }) => {
  const raw = process.env[envVar]?.trim() ?? "";
  const normalized = raw.toLowerCase();
  const status = normalized ? allowedValues.includes(normalized) ? normalized : "invalid" : "not-configured";
  return {
    rail,
    envVar,
    status,
    ready: status === "production-live",
  };
});
const invalid = report.filter((item) => item.status === "invalid");
const missingProduction = report.filter((item) => !item.ready);

console.log(JSON.stringify({
  status: missingProduction.length ? invalid.length ? "invalid" : "not-production-live" : "production-live",
  allowedValues,
  rails: report,
  missingProduction,
}, null, 2));

if (missingProduction.length) process.exit(1);